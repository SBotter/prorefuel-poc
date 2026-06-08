/**
 * MobileRecorder — WebCodecs VideoEncoder + mp4-muxer pipeline.
 *
 * Replaces captureStream() + MediaRecorder + FFmpeg WASM for iOS/Android.
 * Records a canvas at 30fps → H264 MP4 without any server-side processing.
 *
 * Usage:
 *   const rec = await MobileRecorder.create(canvas);
 *   // in requestAnimationFrame loop:
 *   rec.captureFrame();
 *   // when done:
 *   const mp4Blob = await rec.stop();
 */

// @ts-ignore — mp4-muxer ships its own types
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { mlog } from '@/lib/engine/mobile/mobileDebugLogger';

// 720×1280 keeps Instagram quality on phone screens while halving VideoFrame
// memory vs 1080×1920 (3.7 MB/frame → significant OOM relief on iOS).
export const MOBILE_W   = 720;
export const MOBILE_H   = 1280;
export const MOBILE_FPS = 30;

const FRAME_DUR_US  = Math.round(1_000_000 / MOBILE_FPS); // microseconds per frame
// 4 Mbps gives excellent quality at 720×1280.
// At 8 Mbps the ArrayBufferTarget accumulated ~59 MB for a 59s clip → OOM on iOS.
// 4 Mbps halves the in-memory encoded data (~15 MB for a 30s cap).
const VIDEO_BITRATE = 4_000_000;

// H264 codec strings ordered by quality preference.
// All supported on iOS 16.4+ and Android Chrome 94+.
const H264_CANDIDATES = [
  'avc1.640028', // High Profile Level 4.0 — best quality, Apple HW accelerated
  'avc1.4d0028', // Main Profile Level 4.0
  'avc1.42002a', // Baseline Level 4.2 — widest compatibility
];

async function selectH264Codec(): Promise<string | null> {
  for (const codec of H264_CANDIDATES) {
    try {
      const result = await VideoEncoder.isConfigSupported({
        codec, width: MOBILE_W, height: MOBILE_H,
        bitrate: VIDEO_BITRATE, framerate: MOBILE_FPS,
      });
      if (result.supported) return codec;
    } catch { /* try next */ }
  }
  return null;
}

export class MobileRecorder {
  private _encoder: VideoEncoder;
  private _audioEncoder: AudioEncoder | null = null;
  private _muxer: InstanceType<typeof Muxer>;
  private _canvas: HTMLCanvasElement;
  private _frameCount = 0;
  private _error: Error | null = null;

  private constructor(
    encoder: VideoEncoder,
    audioEncoder: AudioEncoder | null,
    muxer: InstanceType<typeof Muxer>,
    canvas: HTMLCanvasElement,
  ) {
    this._encoder = encoder;
    this._audioEncoder = audioEncoder;
    this._muxer   = muxer;
    this._canvas  = canvas;
  }

  /** Creates and configures the encoder. Throws if H264 is not available. */
  static async create(canvas: HTMLCanvasElement, audioSampleRate?: number): Promise<MobileRecorder> {
    const codec = await selectH264Codec();
    if (!codec) throw new Error('H264 video encoding is not supported on this device.');

    const target = new ArrayBufferTarget();
    const muxer  = new Muxer({
      target,
      video:      { codec: 'avc', width: MOBILE_W, height: MOBILE_H },
      audio: audioSampleRate ? {
        codec: 'aac',
        numberOfChannels: 2,
        sampleRate: audioSampleRate,
      } : undefined,
      fastStart:  false,
      // Wall-clock timestamps start at ~37ms (not 0) because the first rAF tick
      // fires slightly after recStartMs. 'offset' subtracts the first timestamp
      // from all subsequent ones so DTS always starts at 0 in the container.
      firstTimestampBehavior: 'offset',
    });

    // Placeholder — replaced once the class instance exists
    let self: MobileRecorder;

    const encoder = new VideoEncoder({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      output: (chunk: EncodedVideoChunk, meta: any) => {
        if (self._error) return;
        try { muxer.addVideoChunk(chunk, meta ?? undefined); }
        catch (e) {
          mlog('MUXER_ERR', String(e));  // distinguish from encoder error
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
      width:  MOBILE_W,
      height: MOBILE_H,
      bitrate: VIDEO_BITRATE,
      framerate: MOBILE_FPS,
      hardwareAcceleration: 'prefer-hardware',
      // 'realtime' uses less internal buffering than 'quality' — more stable on iOS
      // when the video element briefly drops to readyState=0 during seeks.
      latencyMode: 'realtime',
    });

    let audioEncoder: AudioEncoder | null = null;
    if (audioSampleRate) {
      audioEncoder = new AudioEncoder({
        output: (chunk: EncodedAudioChunk, meta: any) => {
          if (self._error) return;
          try { muxer.addAudioChunk(chunk, meta ?? undefined); }
          catch (e) {
            mlog('AUDIO_MUXER_ERR', String(e));
            self._error = e as Error;
          }
        },
        error: (e: DOMException) => {
          mlog('AUDIO_ENCODER_ERR', `${e.name}: ${e.message}`);
          if (self) self._error = e;
        },
      });

      audioEncoder.configure({
        codec: 'mp4a.40.2', // AAC LC
        numberOfChannels: 2,
        sampleRate: audioSampleRate,
        bitrate: 128000,
      });
    }

    self = new MobileRecorder(encoder, audioEncoder, muxer, canvas);
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
   * Captures the current canvas state as one video frame.
   * Call once per requestAnimationFrame tick.
   *
   * Pass videoReady=false to skip the frame (e.g. during a video seek when
   * readyState=0 — encoding blank/stale frames crashes the iOS VideoEncoder).
   */
  /**
   * Capture current canvas state as one encoded frame.
   *
   * @param videoReady  false → skip (video element is seeking / readyState < 2)
   * @param timestampUs explicit timestamp in µs (for RVFC-driven ACTION capture);
   *                    omit to use frame-count-based monotonic timestamp (INTRO/BRAND)
   */
  captureFrame(videoReady = true, timestampUs?: number): void {
    if (this._error) return;
    if (this._encoder.state !== 'configured') {
      mlog('CAPTURE_SKIP', `encoder state=${this._encoder.state}`);
      return;
    }
    if (!videoReady) return;

    // Back-pressure guard
    if (this._encoder.encodeQueueSize > 10) return;

    const ts = timestampUs ?? (this._frameCount * FRAME_DUR_US);
    const frame = new VideoFrame(this._canvas, {
      timestamp: ts,
      duration:  FRAME_DUR_US,
    });

    this._encoder.encode(frame, { keyFrame: this._frameCount % (MOBILE_FPS * 2) === 0 });
    frame.close();
    this._frameCount++;
  }

  /**
   * Encodes a single audio block.
   */
  encodeAudio(audioData: AudioData): void {
    if (this._error) return;
    if (!this._audioEncoder) return;
    if (this._audioEncoder.state !== 'configured') {
      mlog('AUDIO_CAPTURE_SKIP', `audio encoder state=${this._audioEncoder.state}`);
      return;
    }
    this._audioEncoder.encode(audioData);
    audioData.close();
  }

  /**
   * Flushes the encoders, finalizes the MP4 container, and returns the blob.
   * Must be called exactly once, after the last captureFrame().
   */
  async stop(): Promise<Blob> {
    if (this._error) throw this._error;

    const promises: Promise<void>[] = [this._encoder.flush()];
    if (this._audioEncoder) {
      promises.push(this._audioEncoder.flush());
    }
    await Promise.all(promises);

    this._encoder.close();
    if (this._audioEncoder) {
      this._audioEncoder.close();
    }
    if (this._error) throw this._error;

    this._muxer.finalize();

    const buffer: ArrayBuffer = (this._muxer.target as InstanceType<typeof ArrayBufferTarget>).buffer;
    return new Blob([buffer], { type: 'video/mp4' });
  }
}
