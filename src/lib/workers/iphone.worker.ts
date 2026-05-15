/**
 * iPhone Worker — extracts video metadata from iPhone MOV files.
 *
 * ── Why native parsing instead of exifr ───────────────────────────────────────
 * exifr 7.x does not support files with QuickTime brand ('qt  ').
 * All iPhone cameras record in pure QuickTime format — not MPEG-4/MP4 —
 * so exifr throws "Unknown file format" on every iPhone MOV.
 *
 * This worker parses the QuickTime/ISOBMFF container natively:
 *   1. Traverses top-level boxes (ftyp, wide, mdat, moov) reading only
 *      16-byte headers — no seek into the multi-GB video stream.
 *   2. Reads the full moov box content (typically < 1 MB).
 *   3. Parses moov/mvhd for CreateDate (UTC, Mac epoch) and Duration.
 *   4. Parses moov/meta (Apple QuickTime metadata) for GPS and camera model.
 *
 * ── What iPhone MOV files contain ────────────────────────────────────────────
 *   ✅ mvhd CreateDate   — precise UTC recording start time (Mac epoch → Unix)
 *   ✅ mvhd Duration     — exact video length via timescale/duration pair
 *   ✅ Make / Model      — via com.apple.quicktime.make / .model
 *   ⚠️  GPS              — com.apple.quicktime.location.ISO6709 (optional)
 *   ❌ GPS track         — no continuous GPS telemetry (unlike GoPro GPMF)
 *   ❌ Accelerometer     — not embedded
 *   ❌ Gyroscope         — not embedded
 *
 * ── Output ───────────────────────────────────────────────────────────────────
 * Two synthetic boundary GPSPoints that define the video's time window in UTC:
 *   points[0].time = createDateMs       (video frame 0)
 *   points[1].time = createDateMs + durationMs  (last frame)
 *
 * ── Sync model ───────────────────────────────────────────────────────────────
 * iPhone clock is NTP UTC; activity GPS is satellite UTC → same reference.
 * clockOffset = 0, gpsVideoOffsetMs = 0.
 */

export type iPhoneWorkerErrorCode =
  | 'IPHONE_READ_FAILED'    // file cannot be parsed / no moov box found
  | 'IPHONE_NO_TIMESTAMP'   // mvhd absent or CreateDate tag absent
  | 'IPHONE_INVALID_DATE'   // CreateDate present but invalid / year < 2000
  | 'IPHONE_NO_DURATION';   // Duration zero or missing

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
  code:  iPhoneWorkerErrorCode;
}

const ERROR_MESSAGES: Record<iPhoneWorkerErrorCode, string> = {
  IPHONE_READ_FAILED:  'Could not read this file. Is it a valid iPhone MOV?',
  IPHONE_NO_TIMESTAMP: 'No timestamp found. Enable Location Services for Camera in iPhone Settings.',
  IPHONE_INVALID_DATE: 'Video timestamp is corrupted or invalid.',
  IPHONE_NO_DURATION:  'Could not read video duration. File may be incomplete.',
};

// ── QuickTime / ISOBMFF binary utilities ──────────────────────────────────────

/** Read big-endian uint32 */
function u32(d: Uint8Array, o: number): number {
  return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

/** Read big-endian uint64 as JS number (safe up to 2^53 — fine for timestamps) */
function u64(d: Uint8Array, o: number): number {
  return u32(d, o) * 4294967296 + u32(d, o + 4);
}

/** Read 4-char box type at offset */
function fourcc(d: Uint8Array, o: number): string {
  return String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
}

/**
 * Find first box of given 4-char type within a Uint8Array.
 * Returns the box content (data after the box header), or null.
 * Scans sequentially at the given level — does not recurse.
 */
function findBox(d: Uint8Array, type: string, startPos = 0): Uint8Array | null {
  let pos = startPos;
  const LIMIT = 256; // safety: max boxes scanned at one level
  for (let i = 0; i < LIMIT && pos + 8 <= d.length; i++) {
    const size32 = u32(d, pos);
    const t      = fourcc(d, pos + 4);

    let totalSize: number;
    let hdrSize:   number;

    if (size32 === 1 && pos + 16 <= d.length) {
      totalSize = u64(d, pos + 8);
      hdrSize   = 16;
    } else if (size32 === 0) {
      totalSize = d.length - pos;   // box extends to end of buffer
      hdrSize   = 8;
    } else {
      totalSize = size32;
      hdrSize   = 8;
    }

    if (totalSize < 8) break; // corrupt

    if (t === type) {
      const end = Math.min(pos + hdrSize + (totalSize - hdrSize), d.length);
      return d.subarray(pos + hdrSize, end);
    }

    pos += totalSize;
  }
  return null;
}

/**
 * Navigate the top-level box tree and return the full moov content.
 *
 * iPhone MOV layout (moov is always at the END — written after recording stops):
 *   ftyp (20 bytes) → wide (8 bytes) → mdat (hundreds of MB/GB) → moov (~150 KB)
 *
 * We read only 16-byte box headers to navigate, then read moov in one slice.
 * Total I/O before reaching moov: ≈ 4 × 16 = 64 bytes.
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

// Seconds from Mac epoch (1904-01-01) to Unix epoch (1970-01-01)
const MAC_TO_UNIX_S = 2082844800;

interface MvhdResult { createDateMs: number; durationMs: number }

/**
 * Parse the Movie Header Box (mvhd).
 * version 0: 32-bit creation time, 32-bit modification time, 32-bit timescale, 32-bit duration
 * version 1: 64-bit creation time, 64-bit modification time, 32-bit timescale, 64-bit duration
 */
function parseMvhd(d: Uint8Array): MvhdResult | null {
  if (d.length < 20) return null;
  const version = d[0];

  if (version === 1) {
    if (d.length < 32) return null;
    const createSec = u64(d, 4) - MAC_TO_UNIX_S;
    const timescale = u32(d, 20);
    const dur       = u64(d, 24);
    return {
      createDateMs: createSec * 1000,
      durationMs:   timescale > 0 ? Math.round(dur / timescale * 1000) : 0,
    };
  }

  // version 0 (default for iPhone)
  // layout: [0] version, [1..3] flags, [4..7] creation_time, [8..11] modification_time,
  //         [12..15] timescale, [16..19] duration
  const createSec = u32(d, 4) - MAC_TO_UNIX_S;
  const timescale = u32(d, 12);
  const dur       = u32(d, 16);
  return {
    createDateMs: createSec * 1000,
    durationMs:   timescale > 0 ? Math.round(dur / timescale * 1000) : 0,
  };
}

interface MetaResult {
  make: string;
  model: string;
  latitude?: number;
  longitude?: number;
  /** com.apple.quicktime.creationdate — original recording date, preserved through edits.
   *  Preferred over mvhd CreateDate which is reset on every iOS export/trim. */
  creationdate?: string;
}

/**
 * Parse Apple QuickTime metadata (moov/meta) for camera model and GPS.
 *
 * iPhone QuickTime meta box is a plain container (no FullBox version/flags prefix).
 * Structure inside meta:
 *   hdlr — declares this as a metadata handler ('mdta')
 *   keys — array of string key names (com.apple.quicktime.*)
 *   ilst — array of values indexed by key position (1-based integer in box type field)
 *
 * Each ilst child:
 *   4 bytes  size
 *   4 bytes  1-based key index (big-endian uint32, NOT a 4-char ASCII type)
 *   8+ bytes data box: 4(size) + 4('data') + 4(type indicator) + 4(locale) + value bytes
 */
function parseMeta(moov: Uint8Array): MetaResult {
  const result: MetaResult = { make: 'Apple', model: 'iPhone' };

  const meta = findBox(moov, 'meta');
  if (!meta) return result;

  // QuickTime meta: plain container — children start at offset 0 (no version/flags).
  const keysBox = findBox(meta, 'keys');
  const ilstBox = findBox(meta, 'ilst');
  if (!keysBox || !ilstBox) return result;

  // Parse keys box: [0..3] version/flags, [4..7] entry count, then entries
  if (keysBox.length < 8) return result;
  const keyCount  = u32(keysBox, 4);
  const keyNames: string[] = [];

  let kpos = 8; // skip version(4) + count(4)
  for (let i = 0; i < keyCount && kpos + 8 <= keysBox.length; i++) {
    const ks = u32(keysBox, kpos);
    if (ks < 8 || kpos + ks > keysBox.length) break;
    // entry: 4(size) + 4(namespace 'mdta') + key string
    const keyStr = new TextDecoder().decode(keysBox.subarray(kpos + 8, kpos + ks));
    keyNames.push(keyStr);
    kpos += ks;
  }

  // Parse ilst: each child has a 1-based key index as its box "type" field (uint32)
  let ipos = 0;
  while (ipos + 8 <= ilstBox.length) {
    const entrySize = u32(ilstBox, ipos);
    if (entrySize < 8 || ipos + entrySize > ilstBox.length) break;

    // Read key index (1-based) from the "type" position
    const keyIndex0 = u32(ilstBox, ipos + 4) - 1; // convert to 0-based

    if (keyIndex0 >= 0 && keyIndex0 < keyNames.length && ipos + 24 <= ipos + entrySize) {
      // data box: 4(size)+4('data')+4(type_indicator)+4(locale)+value
      const dataSize = u32(ilstBox, ipos + 8);
      const dataTag  = fourcc(ilstBox, ipos + 12);
      if (dataTag === 'data' && ipos + 8 + dataSize <= ilstBox.length + 4096) {
        const val = new TextDecoder().decode(
          ilstBox.subarray(ipos + 24, Math.min(ipos + 8 + dataSize, ilstBox.length)),
        );
        const key = keyNames[keyIndex0];

        if      (key.endsWith('.make'))              result.make  = val.trim() || result.make;
        else if (key.endsWith('.model'))             result.model = val.trim() || result.model;
        else if (key.endsWith('.creationdate'))      result.creationdate = val.trim();
        else if (key.endsWith('.location.ISO6709')) {
          // ISO 6709: "+49.3227-123.0385+110.600/"
          const m = val.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
          if (m) {
            result.latitude  = parseFloat(m[1]);
            result.longitude = parseFloat(m[2]);
          }
        }
      }
    }

    ipos += entrySize;
  }

  return result;
}

// ── Worker message handler ─────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<{ file: File }>) => {
  const file = e.data.file;

  console.log(`[iPhone Worker] Processing ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

  // ── Step 1: Locate and read the moov box ──────────────────────────────────
  let moov: Uint8Array | null = null;

  try {
    moov = await findMoovContent(file);
  } catch (err: any) {
    console.error('[iPhone Worker] moov read error:', err.message);
    self.postMessage({ success: false, error: ERROR_MESSAGES.IPHONE_READ_FAILED, code: 'IPHONE_READ_FAILED' } as WorkerErrorPayload);
    return;
  }

  if (!moov) {
    console.error('[iPhone Worker] No moov box found — not a valid QuickTime/MP4 file.');
    self.postMessage({ success: false, error: ERROR_MESSAGES.IPHONE_READ_FAILED, code: 'IPHONE_READ_FAILED' } as WorkerErrorPayload);
    return;
  }

  // ── Step 2: Parse mvhd → CreateDate (UTC) + Duration ─────────────────────
  const mvhdData = findBox(moov, 'mvhd');
  if (!mvhdData) {
    console.error('[iPhone Worker] mvhd box not found inside moov.');
    self.postMessage({ success: false, error: ERROR_MESSAGES.IPHONE_NO_TIMESTAMP, code: 'IPHONE_NO_TIMESTAMP' } as WorkerErrorPayload);
    return;
  }

  const mvhd = parseMvhd(mvhdData);
  if (!mvhd) {
    console.error('[iPhone Worker] Failed to parse mvhd content.');
    self.postMessage({ success: false, error: ERROR_MESSAGES.IPHONE_INVALID_DATE, code: 'IPHONE_INVALID_DATE' } as WorkerErrorPayload);
    return;
  }

  const { durationMs } = mvhd;
  let { createDateMs } = mvhd;

  if (isNaN(createDateMs) || createDateMs < new Date('2000-01-01').getTime()) {
    console.error('[iPhone Worker] CreateDate out of range:', new Date(createDateMs).toISOString());
    self.postMessage({ success: false, error: ERROR_MESSAGES.IPHONE_INVALID_DATE, code: 'IPHONE_INVALID_DATE' } as WorkerErrorPayload);
    return;
  }

  if (durationMs <= 0) {
    console.error('[iPhone Worker] Duration invalid:', durationMs);
    self.postMessage({ success: false, error: ERROR_MESSAGES.IPHONE_NO_DURATION, code: 'IPHONE_NO_DURATION' } as WorkerErrorPayload);
    return;
  }

  // ── Step 3: Parse moov/meta → GPS + Make/Model ────────────────────────────
  const meta = parseMeta(moov);

  // ── Prefer com.apple.quicktime.creationdate over mvhd CreateDate ─────────────
  // mvhd CreateDate is RESET on every iOS export/trim/edit.
  // com.apple.quicktime.creationdate preserves the original recording date.
  // Example: user records on May 10, trims on May 15 → mvhd=May 15, .creationdate=May 10.
  if (meta.creationdate) {
    const qtDate = new Date(meta.creationdate);
    if (!isNaN(qtDate.getTime()) && qtDate.getFullYear() >= 2000) {
      console.log(`[iPhone Worker] Overriding mvhd (${new Date(createDateMs).toISOString()}) with com.apple.quicktime.creationdate: ${meta.creationdate}`);
      createDateMs = qtDate.getTime();
    }
  }

  const startLat    = meta.latitude  ?? 0;
  const startLon    = meta.longitude ?? 0;
  const hasStartGPS = meta.latitude !== undefined && meta.longitude !== undefined &&
                      isFinite(startLat) && isFinite(startLon) &&
                      Math.abs(startLat) > 0.001 && Math.abs(startLon) > 0.001;

  // ── Step 4: Build camera model string ────────────────────────────────────
  const make  = meta.make.trim();
  const model = meta.model.trim();
  const cameraModel = model.toLowerCase().startsWith(make.toLowerCase())
    ? model
    : `${make} ${model}`.trim();

  // ── Step 5: Build synthetic boundary points ───────────────────────────────
  const endDateMs  = createDateMs + durationMs;
  const startPoint = { lat: startLat, lon: startLon, ele: 0, time: createDateMs };
  const endPoint   = { lat: startLat, lon: startLon, ele: 0, time: endDateMs };

  console.log('[iPhone Worker] Summary:', {
    cameraModel,
    createDate:       new Date(createDateMs).toISOString(),
    qtCreationDate:   meta.creationdate ?? '(not present)',
    durationSec:      (durationMs / 1000).toFixed(1),
    endDate:          new Date(endDateMs).toISOString(),
    hasStartGPS,
    startLat:         startLat.toFixed(6),
    startLon:         startLon.toFixed(6),
  });

  self.postMessage({
    success:          true,
    points:           [startPoint, endPoint],
    syncPoints:       [startPoint, endPoint],
    cameraModel,
    gpsVideoOffsetMs: 0,
    videoStartMs:     createDateMs,
    durationMs,
    hasStartGPS,
  } as WorkerSuccessPayload);
};
