/**
 * Android Worker — extracts video metadata from Android MP4 files.
 *
 * ── Why native parsing ────────────────────────────────────────────────────────
 * Android MP4 files use MPEG-4 brand ('mp42'/'isom'), not QuickTime.
 * exifr 7.x can parse the brand but does not expose CreateDate reliably
 * for all Android vendors. Native ISOBMFF parsing is used for consistency.
 *
 * ── Key difference from iPhone ───────────────────────────────────────────────
 * iPhone:  moov/mvhd CreateDate = START of recording
 * Android: moov/mvhd CreateDate = 0 (invalid on many vendors)
 *          moov/trak/tkhd CreateDate = END of recording
 *          videoStartMs = tkhd.createDateMs − mdhd.durationMs
 *
 * Verified on Samsung Galaxy S24 FE (SM-S721W):
 *   tkhd CreateDate   = 2026-05-12T18:30:50 UTC  (end)
 *   mdhd duration     = 41.34 s
 *   videoStartMs      = 18:30:08.66 UTC  ←  matches filename 20260512_113007
 *
 * ── What Android MP4 files contain ───────────────────────────────────────────
 *   ✅ tkhd CreateDate   — precise UTC recording END time (Mac epoch → Unix)
 *   ✅ mdhd duration     — exact video length via timescale/duration pair
 *   ✅ udta/auth         — device model (e.g. "Galaxy S24 FE")
 *   ⚠️  Samsung UTC offset — com.samsung.android.utc_offset (optional)
 *   ❌ GPS track         — no continuous GPS telemetry
 *   ❌ GPS start point   — no location embedded (unlike iPhone)
 *
 * ── Output ───────────────────────────────────────────────────────────────────
 * Two synthetic boundary GPSPoints that define the video's time window in UTC:
 *   points[0].time = videoStartMs          (video frame 0)
 *   points[1].time = videoStartMs + durationMs  (last frame)
 *
 * ── Sync model ───────────────────────────────────────────────────────────────
 * Android clock is NTP UTC; activity GPS is satellite UTC → same reference.
 * clockOffset = 0, gpsVideoOffsetMs = 0.
 */

export type AndroidWorkerErrorCode =
  | 'ANDROID_READ_FAILED'   // file cannot be parsed / no moov box found
  | 'ANDROID_NO_TIMESTAMP'  // tkhd absent or CreateDate invalid
  | 'ANDROID_INVALID_DATE'  // CreateDate present but invalid / year < 2000
  | 'ANDROID_NO_DURATION';  // Duration zero or missing

interface WorkerSuccessPayload {
  success: true;
  points:           { lat: number; lon: number; ele: number; time: number }[];
  syncPoints:       { lat: number; lon: number; ele: number; time: number }[];
  cameraModel:      string;
  gpsVideoOffsetMs: number;
  videoStartMs:     number;
  durationMs:       number;
  hasStartGPS:      boolean;
}

interface WorkerErrorPayload {
  success: false;
  error: string;
  code:  AndroidWorkerErrorCode;
}

const ERROR_MESSAGES: Record<AndroidWorkerErrorCode, string> = {
  ANDROID_READ_FAILED:  'Could not read this file. Is it a valid Android MP4?',
  ANDROID_NO_TIMESTAMP: 'No timestamp found in this video.',
  ANDROID_INVALID_DATE: 'Video timestamp is corrupted or invalid.',
  ANDROID_NO_DURATION:  'Could not read video duration. File may be incomplete.',
};

// ── QuickTime / ISOBMFF binary utilities ──────────────────────────────────────

function u32(d: Uint8Array, o: number): number {
  return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

function u64(d: Uint8Array, o: number): number {
  return u32(d, o) * 4294967296 + u32(d, o + 4);
}

function fourcc(d: Uint8Array, o: number): string {
  return String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
}

function findBox(d: Uint8Array, type: string, startPos = 0): Uint8Array | null {
  let pos = startPos;
  const LIMIT = 256;
  for (let i = 0; i < LIMIT && pos + 8 <= d.length; i++) {
    const size32 = u32(d, pos);
    const t      = fourcc(d, pos + 4);

    let totalSize: number;
    let hdrSize:   number;

    if (size32 === 1 && pos + 16 <= d.length) {
      totalSize = u64(d, pos + 8);
      hdrSize   = 16;
    } else if (size32 === 0) {
      totalSize = d.length - pos;
      hdrSize   = 8;
    } else {
      totalSize = size32;
      hdrSize   = 8;
    }

    if (totalSize < 8) break;

    if (t === type) {
      const end = Math.min(pos + hdrSize + (totalSize - hdrSize), d.length);
      return d.subarray(pos + hdrSize, end);
    }

    pos += totalSize;
  }
  return null;
}

/**
 * Find moov box by scanning top-level box headers.
 * moov is at the END of Android MP4 files (written after recording stops).
 */
async function findMoovContent(file: File, maxBytes = 12 * 1024 * 1024): Promise<Uint8Array | null> {
  let pos = 0;
  const MAX_BOXES = 64;

  for (let i = 0; i < MAX_BOXES && pos < file.size; i++) {
    const hdrLen = Math.min(16, file.size - pos);
    const hdrBuf = await file.slice(pos, pos + hdrLen).arrayBuffer();
    const hdr    = new Uint8Array(hdrBuf);
    if (hdr.length < 8) break;

    const size32 = u32(hdr, 0);
    const type   = fourcc(hdr, 4);

    let boxSize: number;
    let hdrSize: number;

    if (size32 === 1 && hdr.length >= 16) {
      boxSize = u64(hdr, 8);
      hdrSize = 16;
    } else if (size32 === 0) {
      boxSize = file.size - pos;
      hdrSize = 8;
    } else {
      boxSize = size32;
      hdrSize = 8;
    }

    if (boxSize < 8) break;

    if (type === 'moov') {
      const readSize = Math.min(boxSize - hdrSize, maxBytes);
      const buf = await file.slice(pos + hdrSize, pos + hdrSize + readSize).arrayBuffer();
      return new Uint8Array(buf);
    }

    pos += boxSize;
  }

  return null;
}

const MAC_TO_UNIX_S = 2082844800;

interface TkhdResult { createDateMs: number }

function parseTkhd(d: Uint8Array): TkhdResult | null {
  if (d.length < 8) return null;
  const version = d[0];
  let createSec: number;

  if (version === 1) {
    if (d.length < 24) return null;
    createSec = u64(d, 4) - MAC_TO_UNIX_S;
  } else {
    // version 0: [1 version][3 flags][4 create][4 modify][4 trackId][4 reserved][4 duration]
    if (d.length < 8) return null;
    createSec = u32(d, 4) - MAC_TO_UNIX_S;
  }

  return { createDateMs: createSec * 1000 };
}

interface MdhdResult { durationMs: number }

function parseMdhd(d: Uint8Array): MdhdResult | null {
  if (d.length < 20) return null;
  const version = d[0];

  if (version === 1) {
    if (d.length < 32) return null;
    const timescale = u32(d, 20);
    const dur       = u64(d, 24);
    return { durationMs: timescale > 0 ? Math.round((dur / timescale) * 1000) : 0 };
  }

  // version 0: [1][3][4 create][4 modify][4 timescale][4 duration]
  const timescale = u32(d, 12);
  const dur       = u32(d, 16);
  return { durationMs: timescale > 0 ? Math.round((dur / timescale) * 1000) : 0 };
}

/**
 * Find the video track (handler type 'vide') and return its tkhd + mdhd.
 * Falls back to first trak if no video handler is found.
 */
interface VideoTrackResult { createDateMs: number; durationMs: number }

function parseVideoTrack(moov: Uint8Array): VideoTrackResult | null {
  let pos = 0;
  const LIMIT = 32;
  let firstResult: VideoTrackResult | null = null;

  for (let i = 0; i < LIMIT && pos + 8 <= moov.length; i++) {
    const size32 = u32(moov, pos);
    const type   = fourcc(moov, pos + 4);
    const totalSize = size32 === 0 ? moov.length - pos : size32;
    if (totalSize < 8) break;

    if (type === 'trak') {
      const trak = moov.subarray(pos + 8, pos + totalSize);

      const tkhdData = findBox(trak, 'tkhd');
      const mdia     = findBox(trak, 'mdia');
      const mdhdData = mdia ? findBox(mdia, 'mdhd') : null;

      if (tkhdData && mdhdData) {
        const tkhd = parseTkhd(tkhdData);
        const mdhd = parseMdhd(mdhdData);

        if (tkhd && mdhd && mdhd.durationMs > 0) {
          const result = { createDateMs: tkhd.createDateMs, durationMs: mdhd.durationMs };

          // Check handler type — prefer video track ('vide')
          const hdlr = findBox(mdia!, 'hdlr');
          if (hdlr && hdlr.length >= 12) {
            const handler = fourcc(hdlr, 8); // after [1 version][3 flags][4 pre_defined]
            if (handler === 'vide') return result; // video track confirmed
          }

          if (!firstResult) firstResult = result;
        }
      }
    }

    pos += totalSize;
  }

  return firstResult;
}

/**
 * Extract device model from moov/udta.
 * Checks 'auth' box (3GPP Author, contains friendly name like "Galaxy S24 FE"),
 * then Samsung 'smta' box as fallback.
 */
function parseUdtaModel(moov: Uint8Array): string {
  const udta = findBox(moov, 'udta');
  if (!udta) return '';

  // auth box: FullBox [4 version/flags][2 language][...UTF-8 string]
  const auth = findBox(udta, 'auth');
  if (auth && auth.length > 6) {
    // Skip 4-byte version/flags + 2-byte language, decode UTF-8 until null
    const str = new TextDecoder('utf-8', { fatal: false })
      .decode(auth.subarray(6))
      .replace(/\0.*$/, '')
      .trim();
    if (str.length > 0) return str;
  }

  // Samsung smta box contains "mdlnXXXX" where XXXX is the model number
  const smta = findBox(udta, 'smta');
  if (smta) {
    const raw = new TextDecoder('latin1').decode(smta);
    const m = raw.match(/mdln([A-Za-z0-9\-_ ]+)/);
    if (m) return m[1].trim();
  }

  return '';
}

// ── Worker message handler ─────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<{ file: File }>) => {
  const file = e.data.file;

  console.log(`[Android Worker] Processing ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

  // ── Step 1: Locate moov box ───────────────────────────────────────────────
  let moov: Uint8Array | null = null;
  try {
    moov = await findMoovContent(file);
  } catch (err: any) {
    console.error('[Android Worker] moov read error:', err.message);
    self.postMessage({ success: false, error: ERROR_MESSAGES.ANDROID_READ_FAILED, code: 'ANDROID_READ_FAILED' } as WorkerErrorPayload);
    return;
  }

  if (!moov) {
    console.error('[Android Worker] No moov box found.');
    self.postMessage({ success: false, error: ERROR_MESSAGES.ANDROID_READ_FAILED, code: 'ANDROID_READ_FAILED' } as WorkerErrorPayload);
    return;
  }

  // ── Step 2: Parse video track → tkhd (END timestamp) + mdhd (duration) ──
  const videoTrack = parseVideoTrack(moov);

  if (!videoTrack) {
    console.error('[Android Worker] No video track with tkhd + mdhd found.');
    self.postMessage({ success: false, error: ERROR_MESSAGES.ANDROID_NO_TIMESTAMP, code: 'ANDROID_NO_TIMESTAMP' } as WorkerErrorPayload);
    return;
  }

  const { createDateMs, durationMs } = videoTrack;

  if (isNaN(createDateMs) || createDateMs < new Date('2000-01-01').getTime()) {
    console.error('[Android Worker] CreateDate out of range:', new Date(createDateMs).toISOString());
    self.postMessage({ success: false, error: ERROR_MESSAGES.ANDROID_INVALID_DATE, code: 'ANDROID_INVALID_DATE' } as WorkerErrorPayload);
    return;
  }

  if (durationMs <= 0) {
    console.error('[Android Worker] Duration invalid:', durationMs);
    self.postMessage({ success: false, error: ERROR_MESSAGES.ANDROID_NO_DURATION, code: 'ANDROID_NO_DURATION' } as WorkerErrorPayload);
    return;
  }

  // Android tkhd stores END time → subtract duration to get START
  const videoStartMs = createDateMs - durationMs;

  // ── Step 3: Parse device model ────────────────────────────────────────────
  const rawModel    = parseUdtaModel(moov);
  const cameraModel = rawModel || 'Android Camera';

  // ── Step 4: Build synthetic boundary points ───────────────────────────────
  const endMs       = videoStartMs + durationMs;
  const startPoint  = { lat: 0, lon: 0, ele: 0, time: videoStartMs };
  const endPoint    = { lat: 0, lon: 0, ele: 0, time: endMs };

  console.log('[Android Worker] Summary:', {
    cameraModel,
    videoStart:  new Date(videoStartMs).toISOString(),
    videoEnd:    new Date(endMs).toISOString(),
    durationSec: (durationMs / 1000).toFixed(1),
    createDate:  new Date(createDateMs).toISOString(),
  });

  self.postMessage({
    success:          true,
    points:           [startPoint, endPoint],
    syncPoints:       [startPoint, endPoint],
    cameraModel,
    gpsVideoOffsetMs: 0,
    videoStartMs,
    durationMs,
    hasStartGPS:      false,
  } as WorkerSuccessPayload);
};
