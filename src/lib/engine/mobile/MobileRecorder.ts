/**
 * MobileRecorder — WebCodecs VideoEncoder + mp4-muxer pipeline.
 *
 * Records a canvas at 30fps → MP4 without any server-side processing.
 *
 * ── Codec strategy per platform ───────────────────────────────────────────────
 *
 * iOS + HEVC source video → VP9 (libvpx, pure software, CPU-only)
 *   iOS Video Toolbox is a shared hardware pool. Any H264 VideoEncoder —
 *   even with 'prefer-software' — uses VTCompressionSession internally.
 *   When a HEVC video is decoded simultaneously (hardware decoder), both
 *   compete for the same VT resources → "Encoding task did not complete"
 *   after ~3 seconds of ACTION.
 *
 *   VP9 on iOS WebKit uses libvpx (open-source software codec), which has
 *   ZERO interaction with Video Toolbox. The HEVC decoder and VP9 encoder
 *   run on completely independent hardware/software paths → no conflict.
 *
 * iOS + H264 source video → H264 prefer-software (VT software path)
 *   H264 decode uses a lighter hardware path than HEVC. prefer-software
 *   encoding is sufficient. No VP9 needed.
 *
 * Android → H264 no-preference
 *   Android MediaCodec separates decoder and encoder at the hardware level.
 *   No pool conflict. Hardware H264 encoding is faster and stable.
 *
 * Usage:
 *   const isIOS       = /iPhone|iPad|iPod/i.test(navigator.userAgent);
 *   const sourceIsHEVC = /* detected from video probe * /;
 *   const rec = await MobileRecorder.create(canvas, { isIOS, sourceIsHEVC });
 *   rec.captureFrame(videoReady, timestampUs);  // in rAF loop
 *   const blob = await rec.stop();              // when done
 */

// @ts-ignore — mp4-muxer ships its own types
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { mlog } from '@/lib/engine/mobile/mobileDebugLogger';

export const MOBILE_W   = 720;
export const MOBILE_H   = 1280;
export const MOBILE_FPS = 30;

const FRAME_DUR_US = Math.round(1_000_000 / MOBILE_FPS);

// 2.5 Mbps: ~9 MB for a 30s clip — safe for ArrayBufferTarget on mobile.
const VIDEO_BITRATE = 2_500_000;

// Back-pressure guard: skip frame when encoder queue is too deep.
const QUEUE_DEPTH_LIMIT = 4;

type HWAccel = 'no-preference' | 'prefer-hardware' | 'prefer-software';

// ── H264 codec selection ───────────────────────────────────────────────────────

const H264_CANDIDATES = [
  'avc1.640028', // High Profile Level 4.0
  'avc1.4d0028', // Main Profile Level 4.0
  'avc1.42002a', // Baseline Level 4.2
];

async function selectH264Codec(acceleration: HWAccel): Promise<string | null> {
  for (const codec of H264_CANDIDATES) {
    try {
      const r = await VideoEncoder.isConfigSupported({
        codec, width: MOBILE_W, height: MOBILE_H,
        bitrate: VIDEO_BITRATE, framerate: MOBILE_FPS,
        hardwareAcceleration: acceleration,
      });
      if (r.supported) return codec;
    } catch { /* try next */ }
  }
  return null;
}

// ── VP9 codec selection ────────────────────────────────────────────────────────
// VP9 Profile 0 = 8-bit 4:2:0. Supported in iOS 16.4+ (libvpx, software only).
// Profile 10 = 10-bit but we don't need HDR output — Profile 0 is correct.
const VP9_CANDIDATES = [
  'vp09.00.31.08', // VP9 Profile 0, Level 3.1 (720×1280 @ 30fps)
  'vp09.00.30.08', // VP9 Profile 0, Level 3.0
  'vp09.00.20.08', // VP9 Profile 0, Level 2.0
];

async function selectVP9Codec(): Promise<string | null> {
  for (const codec of VP9_CANDIDATES) {
    try {
      const r = await VideoEncoder.isConfigSupported({
        codec, width: MOBILE_W, height: MOBILE_H,
        bitrate: VIDEO_BITRATE, framerate: MOBILE_FPS,
        hardwareAcceleration: 'prefer-software', // libvpx = always software
      });
      if (r.supported) return codec;
    } catch { /* try next */ }
  }
  return null;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface MobileRecorderOptions {
  /** true on iOS — affects codec and hardware acceleration strategy. */
  isIOS: boolean;
  /**
   * true when the source video uses HEVC (H.265).
   * Forces VP9 output on iOS to avoid Video Toolbox hardware conflict.
   * On Android, HEVC sources can use H264 hardware encoding safely.
   */
  sourceIsHEVC: boolean;
}

// ── Main class ────────────────────────────────────────────────────────────────

export class MobileRecorder {
  private _encoder: VideoEncoder;
  private _muxer: InstanceType<typeof Muxer>;
  private _canvas: HTMLCanvasElement;
  private _frameCount = 0;
  private _error: Error | null = null;
  private _muxerCodec: 'avc' | 'vp9' = 'avc';

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
   * Codec selection:
   *   iOS + HEVC source → VP9 (libvpx, no Video Toolbox → no conflict)
   *   iOS + H264 source → H264 prefer-software (VT software path)
   *   Android           → H264 no-preference   (MediaCodec, conflict-free)
   */
  static async create(
    canvas: HTMLCanvasElement,
    opts: MobileRecorderOptions | boolean = false,
  ): Promise<MobileRecorder> {
    // Accept legacy boolean (preferSoftware) for backward compat
    const isIOS        = typeof opts === 'boolean' ? opts       : opts.isIOS;
    const sourceIsHEVC = typeof opts === 'boolean' ? false      : opts.sourceIsHEVC;

    // Decide codec + acceleration
    let codec:        string | null = null;
    let muxerCodec:   'avc' | 'vp9' = 'avc';
    let acceleration: HWAccel = 'no-preference';
    let codecLabel    = '';

    if (isIOS && sourceIsHEVC) {
      // iOS + HEVC source → VP9 (libvpx, zero Video Toolbox interaction)
      codec       = await selectVP9Codec();
      muxerCodec  = 'vp9';
      acceleration = 'prefer-software';
      codecLabel  = `VP9 (libvpx, iOS HEVC source — no VT conflict)`;
    }

    if (!codec) {
      // iOS + H264 source, OR VP9 not supported, OR Android
      const acc  = isIOS ? 'prefer-software' : 'no-preference';
      codec      = await selectH264Codec(acc);
      muxerCodec = 'avc';
      acceleration = acc;
      codecLabel = `H264 ${acc} (${isIOS ? 'iOS' : 'Android'})`;
      if (!codec && isIOS) {
        // prefer-software not available — last resort: no-preference
        codec      = await selectH264Codec('no-preference');
        acceleration = 'no-preference';
        codecLabel = 'H264 no-preference (iOS fallback)';
      }
    }

    if (!codec) throw new Error('Video encoding is not supported on this device.');

    mlog('ENCODER', `codec=${codec} accel=${acceleration} label=${codecLabel}`);

    const target = new ArrayBufferTarget();
    const muxer  = new Muxer({
      target,
      video: { codec: muxerCodec, width: MOBILE_W, height: MOBILE_H },
      fastStart: false,
      firstTimestampBehavior: 'offset',
    });

    let self: MobileRecorder;

    const encoder = new VideoEncoder({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      output: (chunk: EncodedVideoChunk, meta: any) => {
        if (self._error) return;
        try { muxer.addVideoChunk(chunk, meta ?? undefined); }
        catch (e) { mlog('MUXER_ERR', String(e)); self._error = e as Error; }
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
      latencyMode:         'realtime',
    });

    self = new MobileRecorder(encoder, muxer, canvas);
    self._muxerCodec = muxerCodec;
    return self;
  }

  get error(): Error | null { return this._error; }
  /** true when VP9 was used — output needs post-transcode to H264 for Photos compatibility. */
  get wasVP9(): boolean { return this._muxerCodec === 'vp9'; }
  get encoderQueueSize(): number { return this._encoder.encodeQueueSize; }
  get framesCaptured(): number   { return this._frameCount; }
  get estimatedEncodedBytes(): number {
    return this._frameCount * VIDEO_BITRATE / MOBILE_FPS / 8;
  }

  captureFrame(videoReady = true, timestampUs?: number): void {
    if (this._error) return;
    if (this._encoder.state !== 'configured') {
      mlog('CAPTURE_SKIP', `encoder state=${this._encoder.state}`);
      return;
    }
    if (!videoReady) return;
    if (this._encoder.encodeQueueSize > QUEUE_DEPTH_LIMIT) return;

    const ts    = timestampUs ?? (this._frameCount * FRAME_DUR_US);
    const frame = new VideoFrame(this._canvas, { timestamp: ts, duration: FRAME_DUR_US });
    this._encoder.encode(frame, { keyFrame: this._frameCount % (MOBILE_FPS * 2) === 0 });
    frame.close();
    this._frameCount++;
  }

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
