/**
 * WhatsApp Worker — extracts basic MP4 metadata from WhatsApp videos.
 *
 * WhatsApp videos have no telemetry (no GPS, no ACCL, no gyro) and no
 * reliable creation timestamp (mvhd.CreationTime is always 0 — stripped
 * for privacy). This worker extracts only what IS present:
 *   ✅ Video duration  (from mvhd timescale + duration)
 *   ✅ Resolution      (from tkhd width/height — fixed-point 16.16)
 *   ✅ FPS             (from stts time-to-sample table)
 *   ✅ Codec           (from stsd box type: 'avc1', 'hvc1', etc.)
 *   ✅ beam box        (confirms WA origin — already checked by CameraDetector)
 *   ❌ Creation time   (always 0 — stripped by WhatsApp)
 *   ❌ GPS / telemetry (never present in WA-shared videos)
 *
 * Output is intentionally minimal — the ActivityPortraitPlanner drives
 * the story from the GPX file, not from this video.
 */

export type WhatsAppWorkerErrorCode =
  | 'WA_READ_FAILED'
  | 'WA_NO_MOOV'
  | 'WA_NO_DURATION';

interface WorkerSuccessPayload {
  success:     true;
  durationMs:  number;
  width:       number;
  height:      number;
  fps:         number;
  codec:       string;
  isFaststart: boolean;
}

interface WorkerErrorPayload {
  success: false;
  error:   string;
  code:    WhatsAppWorkerErrorCode;
}

// ── ISOBMFF binary utilities (same as android.worker.ts) ──────────────────────

function u32(d: Uint8Array, o: number): number {
  return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

function u64(d: Uint8Array, o: number): number {
  return u32(d, o) * 4294967296 + u32(d, o + 4);
}

function fourcc(d: Uint8Array, o: number): string {
  return String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
}

function findBox(data: Uint8Array, type: string, start = 0): Uint8Array | null {
  let pos = start;
  for (let i = 0; i < 256 && pos + 8 <= data.length; i++) {
    const size32 = u32(data, pos);
    const t      = fourcc(data, pos + 4);
    let totalSize: number;
    let hdrSize:   number;
    if (size32 === 1 && pos + 16 <= data.length) {
      totalSize = u64(data, pos + 8); hdrSize = 16;
    } else if (size32 === 0) {
      totalSize = data.length - pos; hdrSize = 8;
    } else {
      totalSize = size32; hdrSize = 8;
    }
    if (totalSize < 8) break;
    if (t === type) return data.subarray(pos + hdrSize, Math.min(pos + totalSize, data.length));
    pos += totalSize;
  }
  return null;
}

/** Walk top-level boxes to find moov — handles beam box before moov (WA layout). */
async function findMoovContent(file: File, maxBytes = 8 * 1024 * 1024): Promise<{ moov: Uint8Array; isFaststart: boolean } | null> {
  let pos       = 0;
  let mdatSeen  = false;
  const MAX_BOX = 64;

  for (let i = 0; i < MAX_BOX && pos < file.size; i++) {
    const hdrLen = Math.min(16, file.size - pos);
    const hdr    = new Uint8Array(await file.slice(pos, pos + hdrLen).arrayBuffer());
    if (hdr.length < 8) break;

    const size32 = u32(hdr, 0);
    const type   = fourcc(hdr, 4);
    let boxSize: number;
    let hdrSize: number;
    if (size32 === 1 && hdr.length >= 16) {
      boxSize = u64(hdr, 8); hdrSize = 16;
    } else if (size32 === 0) {
      boxSize = file.size - pos; hdrSize = 8;
    } else {
      boxSize = size32; hdrSize = 8;
    }
    if (boxSize < 8) break;

    if (type === 'mdat') mdatSeen = true;

    if (type === 'moov') {
      const readSize = Math.min(boxSize - hdrSize, maxBytes);
      const buf      = await file.slice(pos + hdrSize, pos + hdrSize + readSize).arrayBuffer();
      return { moov: new Uint8Array(buf), isFaststart: !mdatSeen };
    }

    pos += boxSize;
  }
  return null;
}

// ── Parsers ────────────────────────────────────────────────────────────────────

function parseDuration(moov: Uint8Array): number {
  const mvhd = findBox(moov, 'mvhd');
  if (!mvhd || mvhd.length < 20) return 0;
  const version = mvhd[0];
  if (version === 1) {
    if (mvhd.length < 32) return 0;
    const timescale = u32(mvhd, 20);
    const duration  = u64(mvhd, 24);
    return timescale > 0 ? Math.round((duration / timescale) * 1000) : 0;
  }
  const timescale = u32(mvhd, 12);
  const duration  = u32(mvhd, 16);
  return timescale > 0 ? Math.round((duration / timescale) * 1000) : 0;
}

function parseVideoTrackDimensions(moov: Uint8Array): { width: number; height: number } {
  let pos = 0;
  for (let i = 0; i < 32 && pos + 8 <= moov.length; i++) {
    const size = u32(moov, pos) || moov.length - pos;
    if (fourcc(moov, pos + 4) === 'trak') {
      const trak = moov.subarray(pos + 8, pos + size);
      const tkhd = findBox(trak, 'tkhd');
      if (tkhd && tkhd.length >= 84) {
        // tkhd v0: width at byte 76, height at 80 (fixed-point 16.16)
        const w = u32(tkhd, 76) >>> 16;
        const h = u32(tkhd, 80) >>> 16;
        if (w > 0 && h > 0) return { width: w, height: h };
      }
    }
    pos += (u32(moov, pos) || moov.length - pos);
  }
  return { width: 0, height: 0 };
}

function parseVideoCodecAndFps(moov: Uint8Array): { codec: string; fps: number } {
  let pos = 0;
  for (let i = 0; i < 32 && pos + 8 <= moov.length; i++) {
    const size = u32(moov, pos) || moov.length - pos;
    if (fourcc(moov, pos + 4) === 'trak') {
      const trak   = moov.subarray(pos + 8, pos + size);
      const mdia   = findBox(trak, 'mdia');
      if (!mdia) { pos += size; continue; }

      // Check handler = 'vide'
      const hdlr = findBox(mdia, 'hdlr');
      if (!hdlr || hdlr.length < 12 || fourcc(hdlr, 8) !== 'vide') { pos += size; continue; }

      const minf  = findBox(mdia, 'minf');
      const stbl  = minf ? findBox(minf, 'stbl') : null;
      if (!stbl) { pos += size; continue; }

      // Codec from stsd
      const stsd = findBox(stbl, 'stsd');
      let codec  = 'unknown';
      if (stsd && stsd.length >= 16) {
        codec = fourcc(stsd, 12);  // first sample entry type
      }

      // FPS from stts (time-to-sample)
      let fps = 0;
      const mdhd = findBox(mdia, 'mdhd');
      const stts = findBox(stbl, 'stts');
      if (mdhd && stts && stts.length >= 16) {
        const timescale  = mdhd.length >= 20 ? u32(mdhd, mdhd[0] === 1 ? 20 : 12) : 0;
        const entryCount = u32(stts, 4);
        if (entryCount > 0 && timescale > 0) {
          // Most entries will have the same delta — use the first major-count entry
          let bestDelta = 0, bestCount = 0;
          for (let e = 0; e < Math.min(entryCount, 64); e++) {
            const cnt   = u32(stts, 8 + e * 8);
            const delta = u32(stts, 12 + e * 8);
            if (cnt > bestCount && delta > 0) { bestCount = cnt; bestDelta = delta; }
          }
          if (bestDelta > 0) fps = Math.round((timescale / bestDelta) * 10) / 10;
        }
      }

      return { codec, fps };
    }
    pos += (u32(moov, pos) || moov.length - pos);
  }
  return { codec: 'unknown', fps: 0 };
}

// ── Worker message handler ─────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<{ file: File }>) => {
  const { file } = e.data;
  console.log(`[WhatsApp Worker] Processing ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

  let moovResult: { moov: Uint8Array; isFaststart: boolean } | null = null;
  try {
    moovResult = await findMoovContent(file);
  } catch (err: any) {
    self.postMessage({ success: false, error: 'Could not read file.', code: 'WA_READ_FAILED' } as WorkerErrorPayload);
    return;
  }

  if (!moovResult) {
    self.postMessage({ success: false, error: 'No moov box found in this video.', code: 'WA_NO_MOOV' } as WorkerErrorPayload);
    return;
  }

  const { moov, isFaststart } = moovResult;

  const durationMs = parseDuration(moov);
  if (durationMs <= 0) {
    self.postMessage({ success: false, error: 'Could not read video duration.', code: 'WA_NO_DURATION' } as WorkerErrorPayload);
    return;
  }

  const { width, height }  = parseVideoTrackDimensions(moov);
  const { codec, fps }     = parseVideoCodecAndFps(moov);

  console.log('[WhatsApp Worker] Result:', { durationMs, width, height, fps, codec, isFaststart });

  self.postMessage({
    success: true,
    durationMs,
    width,
    height,
    fps,
    codec,
    isFaststart,
  } as WorkerSuccessPayload);
};
