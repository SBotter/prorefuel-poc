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
// Reads the first 16 KB of the file and searches for H.265 codec fourcc codes
// ('hvc1', 'hev1', 'dvhe') in the MP4 container. This is faster and more
// reliable than canPlayType() which reflects browser capability, not file codec.

export async function isHevcVideo(file: File): Promise<boolean> {
  try {
    const slice  = await file.slice(0, 16_384).arrayBuffer();
    const bytes  = new Uint8Array(slice);
    const find   = (tag: string): boolean => {
      const c = [tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)];
      for (let i = 0; i <= bytes.length - 4; i++) {
        if (bytes[i] === c[0] && bytes[i+1] === c[1] && bytes[i+2] === c[2] && bytes[i+3] === c[3]) return true;
      }
      return false;
    };
    return find('hvc1') || find('hev1') || find('dvhe');
  } catch {
    return false; // cannot determine — let pipeline proceed and handle natively
  }
}

// ── FFmpeg singleton ──────────────────────────────────────────────────────────
// WASM is loaded once and reused. Subsequent calls skip the ~5-10s CDN fetch.

let _ffmpeg: unknown = null;

async function getFFmpeg(): Promise<any> {
  if (_ffmpeg) return _ffmpeg;

  const { FFmpeg }              = await import('@ffmpeg/ffmpeg');
  const { toBlobURL }           = await import('@ffmpeg/util');
  const ff                      = new FFmpeg();
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';

  await ff.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`,   'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  _ffmpeg = ff;
  return ff;
}

// ── Transcoding ───────────────────────────────────────────────────────────────
// Converts H.265 → H.264 using FFmpeg.wasm, preserving audio.
// onProgress receives 0–100 and a human-readable status string.

export async function transcodeHevcToH264(
  file:       File,
  onProgress: (percent: number, status: string) => void,
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

    onProgress(12, 'Converting H.265 → H.264…');
    const exitCode = await ff.exec([
      '-i',       'input.mp4',
      '-c:v',     'libx264',
      '-preset',  'ultrafast', // fastest encode — important on mobile CPU
      '-crf',     '23',        // good quality / speed balance
      '-c:a',     'aac',
      '-b:a',     '128k',
      '-movflags', '+faststart',
      'output.mp4',
    ]);

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
