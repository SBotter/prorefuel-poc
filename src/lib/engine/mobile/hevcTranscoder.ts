/**
 * HEVC / H.265 detection and pre-transcoding for mobile LENS pipeline.
 *
 * Problem: Modern Android phones (Samsung, Pixel, etc.) record video in H.265
 * by default. Android Chrome's `<video>` element + canvas.drawImage() pipeline
 * is unreliable with H.265 blob URLs, causing silent failures during rendering.
 *
 * Solution: Detect H.265 before processing. If found, transcode to H.264 using
 * FFmpeg.wasm (already a project dependency). The rest of the pipeline receives
 * a guaranteed H.264 file and is completely unchanged.
 *
 * Only activated when needed — GoPro, iPhone, and H.264 Android files bypass
 * this entirely with zero overhead.
 */

// ── HEVC Detection ────────────────────────────────────────────────────────────
// Parses the MP4 box structure to locate the moov box, then searches for
// H.265 codec fourccs ('hvc1', 'hev1', 'dvhe') ONLY within that box.
//
// Why box-aware? A naive byte scan of the full file (or last 1 MB) also hits
// the mdat payload — raw entropy-coded H.264 frames — which can coincidentally
// contain those 4-byte sequences, producing false positives that cause H.264
// files to be mistakenly sent through the transcoding path.

const HEVC_FOURCCS = ['hvc1', 'hev1', 'dvhe'] as const;

function readU32BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3]) >>> 0;
}

function hasHevcInRange(buf: Uint8Array, from: number, to: number): boolean {
  for (const tag of HEVC_FOURCCS) {
    const a = tag.charCodeAt(0), b = tag.charCodeAt(1), c = tag.charCodeAt(2), d = tag.charCodeAt(3);
    for (let i = from; i <= to - 4; i++) {
      if (buf[i] === a && buf[i+1] === b && buf[i+2] === c && buf[i+3] === d) return true;
    }
  }
  return false;
}

// Walk flat box list starting at `start` within `buf`, returns moov bounds or null.
function findMoovWalk(buf: Uint8Array, start: number, end: number): [number, number] | null {
  let i = start;
  while (i + 8 <= end) {
    let size = readU32BE(buf, i);
    const type = String.fromCharCode(buf[i+4], buf[i+5], buf[i+6], buf[i+7]);
    if (size === 1 && i + 16 <= end) size = readU32BE(buf, i + 12); // 64-bit extended size (low 32)
    if (size < 8) break;
    if (type === 'moov') return [i, Math.min(i + size, buf.length)];
    if (i + size > end) break;
    i += size;
  }
  return null;
}

// For non-faststart files the tail buffer starts mid-mdat (unparseable from offset 0).
// Scan for a 'moov' box header — search BACKWARDS from the end so that the real moov
// (which sits at EOF) is found before any coincidental 'moov' byte sequences in mdat data.
function findMoovSearch(buf: Uint8Array): [number, number] | null {
  for (let i = buf.length - 8; i >= 0; i--) {
    if (buf[i+4] === 0x6D && buf[i+5] === 0x6F && buf[i+6] === 0x6F && buf[i+7] === 0x76) {
      const size = readU32BE(buf, i);
      if (size >= 1_000 && size <= buf.length) {
        // moov found — use whatever we have (may be truncated if larger than tail read)
        return [i, Math.min(i + size, buf.length)];
      }
    }
  }
  return null;
}

export interface CanBrowserPlayResult {
  /** true if the browser can actually decode this file (seeks and renders a frame). */
  canPlay:     boolean;
  /** Decoded video width in pixels. 0 if the video could not be loaded. */
  videoWidth:  number;
  /** Decoded video height in pixels. 0 if the video could not be loaded. */
  videoHeight: number;
}

/**
 * Probes whether the current browser can actually decode the given video file.
 * Creates a hidden <video> element, loads the blob, and seeks to 0.1 s to
 * trigger real frame decoding — not just container parsing.
 *
 * Returns BOTH the canPlay flag AND the video dimensions. The dimensions come
 * from the HTML5 video element and are 100% reliable even for HEVC/HDR files
 * on iOS where file.slice() PHAsset reads can be unreliable for large files.
 * This makes videoWidth/videoHeight the most reliable 4K/HEVC detection signal
 * available on mobile.
 *
 * Why not canPlayType()? It returns "maybe"/"probably" based on codec strings
 * alone and ignores hardware availability. On Android Chrome it claims HEVC
 * support even on devices that silently fail to decode it. This function
 * confirms actual decode success with a 3-second timeout fallback.
 */
export async function canBrowserPlay(file: File, timeoutMs = 3000): Promise<CanBrowserPlayResult> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<CanBrowserPlayResult>(resolve => {
      const video = document.createElement('video');
      let resolved = false;
      const done = (canPlay: boolean) => {
        if (resolved) return;
        resolved = true;
        const w = video.videoWidth;
        const h = video.videoHeight;
        video.src = '';
        video.load();
        resolve({ canPlay, videoWidth: w, videoHeight: h });
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      video.onerror = () => { clearTimeout(timer); done(false); };
      video.onloadedmetadata = () => {
        if (video.videoWidth === 0) { clearTimeout(timer); done(false); return; }
        video.currentTime = 0.1;
      };
      video.onseeked = () => { clearTimeout(timer); done(video.videoWidth > 0); };
      video.muted    = true;
      video.preload  = 'metadata';
      video.src      = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function isHevcVideo(file: File): Promise<boolean> {
  try {
    // Phase 1: faststart files — moov is at the start
    // 128 KB covers ftyp + moov header for virtually all GoPro, iPhone, and modern Android files.
    const headSize = Math.min(131_072, file.size);
    const head = new Uint8Array(await file.slice(0, headSize).arrayBuffer());
    const moovH = findMoovWalk(head, 0, head.length);
    if (moovH) return hasHevcInRange(head, moovH[0], moovH[1]);

    // Phase 2: non-faststart — moov is at EOF (iPhone MOV, some Android MP4).
    // Read last 3 MB for a larger safety margin. On iOS, file.slice() for large
    // PHAsset-backed camera roll files can return partial data — a bigger tail
    // buffer reduces the chance of the moov landing right at the edge and being
    // missed. 3 MB covers moov boxes for videos up to several hours at 60fps.
    const tailSize = Math.min(3_000_000, file.size);
    const tail = new Uint8Array(await file.slice(file.size - tailSize).arrayBuffer());
    const moovT = findMoovSearch(tail);
    if (moovT) return hasHevcInRange(tail, moovT[0], moovT[1]);

    return false; // moov not found in either probe — assume H.264
  } catch {
    return false;
  }
}

// ── FFmpeg singleton ──────────────────────────────────────────────────────────
// WASM is loaded once and reused. Subsequent calls skip the ~5-10s CDN fetch.

let _ffmpeg: unknown = null;

async function getFFmpeg(): Promise<any> {
  if (_ffmpeg) return _ffmpeg;

  const { FFmpeg }    = await import('@ffmpeg/ffmpeg');
  const { toBlobURL } = await import('@ffmpeg/util');
  const ff            = new FFmpeg();

  // Use multi-threaded build when SharedArrayBuffer is available (requires COOP+COEP headers).
  // MT build uses all CPU cores via pthreads — typically 2-4× faster on mobile.
  // Falls back to single-threaded UMD build when SAB is not available.
  const hasSAB = typeof SharedArrayBuffer !== 'undefined';

  if (hasSAB) {
    const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/esm';
    await ff.load({
      coreURL:   await toBlobURL(`${base}/ffmpeg-core.js`,        'text/javascript'),
      wasmURL:   await toBlobURL(`${base}/ffmpeg-core.wasm`,      'application/wasm'),
      workerURL: await toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript'),
    });
  } else {
    const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    await ff.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`,   'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    });
  }

  _ffmpeg = ff;
  return ff;
}

// ── Transcoding ───────────────────────────────────────────────────────────────
// Converts H.265 → H.264 using FFmpeg.wasm, preserving audio.
// onProgress receives 0–100 and a human-readable status string.

export async function transcodeHevcToH264(
  file:       File,
  onProgress: (percent: number, status: string) => void,
  options?:   { maxHeight?: number },
): Promise<File> {
  const { fetchFile } = await import('@ffmpeg/util');

  onProgress(2, 'Loading converter…');
  const ff = await getFFmpeg();
  onProgress(8, 'Converter ready — starting…');

  // Map FFmpeg 0→1 progress to 10→95 range for the UI
  const listener = ({ progress }: { progress: number }) => {
    onProgress(10 + Math.round(Math.min(progress, 1) * 85), 'Converting…');
  };
  ff.on('progress', listener);

  try {
    onProgress(10, 'Reading video…');
    await ff.writeFile('input.mp4', await fetchFile(file));

    const scaleFilter = options?.maxHeight ? `scale=-2:${options.maxHeight}` : null;
    const label = scaleFilter ? `Converting H.265 → H.264 (1080p)…` : 'Converting H.265 → H.264…';
    onProgress(12, label);

    const ffArgs = [
      '-i',        'input.mp4',
      ...(scaleFilter ? ['-vf', scaleFilter] : []),
      '-c:v',      'libx264',
      '-preset',   'ultrafast',
      '-crf',      '26',
      '-c:a',      'aac',
      '-b:a',      '96k',
      '-movflags', '+faststart',
      '-map_metadata', '0',
      'output.mp4',
    ];
    const exitCode = await ff.exec(ffArgs);

    if (exitCode !== 0) throw new Error(`Transcoding failed (exit code ${exitCode})`);

    onProgress(97, 'Finalising…');
    const data = await ff.readFile('output.mp4') as Uint8Array;
    if (!data || data.length === 0) throw new Error('Transcoding produced an empty file');

    onProgress(100, 'Done');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blob = new Blob([data as any], { type: 'video/mp4' });
    return new File([blob], file.name, { type: 'video/mp4' });

  } finally {
    ff.off('progress', listener);
    ff.deleteFile('input.mp4').catch(() => {});
    ff.deleteFile('output.mp4').catch(() => {});
  }
}
