/**
 * MobileRecorder — WebCodecs VideoEncoder + mp4-muxer pipeline.
 *
 * Replaces captureStream() + MediaRecorder + FFmpeg WASM for iOS/Android.
 * Records a canvas at 30fps → H264 MP4 without any server-side processing.
 *
 * ── iOS / Android difference ──────────────────────────────────────────────────
 *
 * iOS:   Uses 'prefer-software' encoding (CPU-based, bypasses Video Toolbox).
 *        This is REQUIRED because iOS Video Toolbox is a shared hardware pool:
 *        the video decoder (drawImage(videoEl)) and a hardware VideoEncoder both
 *        compete for the same VTCompressionSession resources. Calling flush()
 *        or encode() while the decoder is active causes "Encoding task did not
 *        complete". Software encoding runs on the CPU and has no interaction with
 *        Video Toolbox — zero conflict. iPhone 13+ CPUs encode 720p H264 at
 *        60+ fps in software, well above our 30fps target.
 *
 * Android: Uses 'no-preference'. Android's MediaCodec API separates the decoder
 *          (codec component) and encoder (codec component) at the hardware level —
 *          they do NOT share a pool. Hardware encoding is faster and doesn't
 *          conflict with the video decoder. 'no-preference' lets Chrome choose the
 *          best available encoder for the current device.
 *
 * Usage:
 *   const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
 *   const rec = await MobileRecorder.create(canvas, isIOS);
 *   rec.captureFrame(videoReady, timestampUs);  // in rAF loop
 *   const blob = await rec.stop();              // when done
 */

// @ts-ignore — mp4-muxer ships its own types
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { mlog } from '@/lib/engine/mobile/mobileDebugLogger';

// 720×1280: Instagram-quality portrait, 3.7 MB/frame uncompressed.
// Lower than 1080×1920 to reduce GPU readback cost and RAM pressure.
export const MOBILE_W   = 720;
export const MOBILE_H   = 1280;
export const MOBILE_FPS = 30;

const FRAME_DUR_US = Math.round(1_000_000 / MOBILE_FPS); // µs per frame

// 2.5 Mbps: encoded data accumulates in ArrayBufferTarget in RAM.
// At 4 Mbps a 30s clip = ~15 MB → OOM risk on 3 GB iOS devices.
// At 2.5 Mbps a 30s clip = ~9 MB → safe.
const VIDEO_BITRATE = 2_500_000;

// Back-pressure: skip frame if encoder queue exceeds this depth.
// Keeps the encode pipeline from accumulating a large backlog.
const QUEUE_DEPTH_LIMIT = 4;

// H264 codec strings — ordered highest→lowest quality.
// Tested via isConfigSupported() before use.
const H264_CANDIDATES = [
  'avc1.640028', // High Profile Level 4.0
  'avc1.4d0028', // Main Profile Level 4.0
  'avc1.42002a', // Baseline Level 4.2 — widest compatibility
];

type HWAccel = 'no-preference' | 'prefer-hardware' | 'prefer-software';

async function selectH264Codec(acceleration: HWAccel): Promise<string | null> {
  for (const codec of H264_CANDIDATES) {
    try {
      const result = await VideoEncoder.isConfigSupported({
        codec,
        width:               MOBILE_W,
        height:              MOBILE_H,
        bitrate:             VIDEO_BITRATE,
        framerate:           MOBILE_FPS,
        hardwareAcceleration: acceleration,
      });
      if (result.supported) return codec;
    } catch { /* try next */ }
  }
  return null;
}

export class MobileRecorder {
  private _encoder: VideoEncoder;
  private _muxer: InstanceType<typeof Muxer>;
  private _canvas: HTMLCanvasElement;
  private _frameCount = 0;
  private _error: Error | null = null;

  private constructor(
    encoder: VideoEncoder,
    muxer: InstanceType<typeof Muxer>,
    canvas: HTMLCanvasElement,
  ) {
    this._encoder = encoder;
    this._muxer   = muxer;
    this._canvas  = canvas;
  }

  /**
   * Creates and configures the VideoEncoder.
   *
   * @param canvas      The canvas to capture frames from.
   * @param preferSoftware  true on iOS (avoids Video Toolbox hardware conflict).
   *                        false on Android (hardware encoding is conflict-free).
   */
  static async create(canvas: HTMLCanvasElement, preferSoftware = false): Promise<MobileRecorder> {
    // On iOS: prefer-software to avoid VTCompressionSession conflict with video decoder.
    // On Android: no-preference lets Chrome select the best MediaCodec encoder.
    const acceleration: HWAccel = preferSoftware ? 'prefer-software' : 'no-preference';

    let codec = await selectH264Codec(acceleration);

    if (!codec && preferSoftware) {
      // prefer-software not supported on this WebKit build — fall back.
      // Log the fallback so it's visible in mlog if conflict occurs.
      mlog('ENCODER', 'prefer-software not available — falling back to no-preference');
      codec = await selectH264Codec('no-preference');
    }

    if (!codec) throw new Error('H264 video encoding is not supported on this device.');

    mlog('ENCODER', `codec=${codec} acceleration=${acceleration}`);

    const target = new ArrayBufferTarget();
    const muxer  = new Muxer({
      target,
      video:      { codec: 'avc', width: MOBILE_W, height: MOBILE_H },
      fastStart:  false,
      // 'offset': subtracts the first timestamp so DTS always starts at 0.
      firstTimestampBehavior: 'offset',
    });

    let self: MobileRecorder;

    const encoder = new VideoEncoder({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      output: (chunk: EncodedVideoChunk, meta: any) => {
        if (self._error) return;
        try { muxer.addVideoChunk(chunk, meta ?? undefined); }
        catch (e) {
          mlog('MUXER_ERR', String(e));
          self._error = e as Error;
        }
      },
      error: (e: DOMException) => {
        mlog('ENCODER_ERR', `${e.name}: ${e.message}`);
        if (self) self._error = e;
      },
    });

    encoder.configure({
      codec,
      width:               MOBILE_W,
      height:              MOBILE_H,
      bitrate:             VIDEO_BITRATE,
      framerate:           MOBILE_FPS,
      hardwareAcceleration: acceleration,
      // 'realtime': minimal internal buffering — frames are output as soon as
      // they are encoded, reducing the chance of a large backlog at flush() time.
      latencyMode: 'realtime',
    });

    self = new MobileRecorder(encoder, muxer, canvas);
    return self;
  }

  get error(): Error | null { return this._error; }
  get encoderQueueSize(): number { return this._encoder.encodeQueueSize; }
  get framesCaptured(): number   { return this._frameCount; }

  /** Estimated encoded bytes accumulated so far (approximate). */
  get estimatedEncodedBytes(): number {
    return this._frameCount * VIDEO_BITRATE / MOBILE_FPS / 8;
  }

  /**
   * Captures the current canvas state as one encoded video frame.
   *
   * @param videoReady   false → skip this frame (video element seeking / not ready).
   *                     Encoding blank frames during a seek causes encoder errors.
   * @param timestampUs  Explicit µs timestamp; omits to use monotonic frame-count clock.
   */
  captureFrame(videoReady = true, timestampUs?: number): void {
    if (this._error) return;
    if (this._encoder.state !== 'configured') {
      mlog('CAPTURE_SKIP', `encoder state=${this._encoder.state}`);
      return;
    }
    if (!videoReady) return;

    // Back-pressure: drop frame if the encode queue is full.
    if (this._encoder.encodeQueueSize > QUEUE_DEPTH_LIMIT) return;

    const ts = timestampUs ?? (this._frameCount * FRAME_DUR_US);
    const frame = new VideoFrame(this._canvas, {
      timestamp: ts,
      duration:  FRAME_DUR_US,
    });

    // Keyframe every 2 seconds: balances seek granularity vs output size.
    this._encoder.encode(frame, { keyFrame: this._frameCount % (MOBILE_FPS * 2) === 0 });
    frame.close();
    this._frameCount++;
  }

  /**
   * Flushes the encoder, finalizes the MP4 container, and returns the blob.
   * Call exactly once, after the last captureFrame().
   */
  async stop(): Promise<Blob> {
    if (this._error) throw this._error;

    await this._encoder.flush();
    this._encoder.close();

    if (this._error) throw this._error;

    this._muxer.finalize();

    const buffer: ArrayBuffer = (this._muxer.target as InstanceType<typeof ArrayBufferTarget>).buffer;
    return new Blob([buffer], { type: 'video/mp4' });
  }
}
