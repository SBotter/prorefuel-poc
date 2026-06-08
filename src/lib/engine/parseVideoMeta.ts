/**
 * Lightweight MP4 container metadata extractor.
 * Reads only the first 2 MB of the file (box headers live near the start
 * for faststart files; non-faststart files won't yield resolution/time but
 * will still yield codec + GPMF detection from the tail scan).
 *
 * Extracts without needing a hardware decoder — works even for HEVC on Chrome Windows.
 */

export interface VideoMeta {
  codec:          'hevc' | 'h264' | 'unknown';
  width:          number | null;
  height:         number | null;
  fps:            number | null;
  hasEmbeddedGPS: boolean;            // GPMF / GoPro telemetry stream present
  recordedAt:     string | null;      // ISO 8601 — from mvhd creation_time
}

// Seconds between Mac epoch (1904-01-01) and Unix epoch (1970-01-01)
const APPLE_EPOCH_OFFSET = 2_082_844_800;

function readU32BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3]) >>> 0;
}

function readU16BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 8) | buf[offset+1]) >>> 0;
}

function tag(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(buf[offset], buf[offset+1], buf[offset+2], buf[offset+3]);
}

function hasTag(buf: Uint8Array, name: string): boolean {
  const c = [name.charCodeAt(0), name.charCodeAt(1), name.charCodeAt(2), name.charCodeAt(3)];
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === c[0] && buf[i+1] === c[1] && buf[i+2] === c[2] && buf[i+3] === c[3]) return true;
  }
  return false;
}

/**
 * Walk a flat region of MP4 box bytes and invoke cb for each box found.
 * Non-recursive — handles moov-level and one level of nesting.
 */
function walkBoxes(buf: Uint8Array, start: number, end: number, cb: (type: string, boxStart: number, contentStart: number, size: number) => void) {
  let i = start;
  while (i + 8 <= end) {
    let size = readU32BE(buf, i);
    const boxType = tag(buf, i + 4);

    if (size === 0) break;           // box extends to EOF — stop
    if (size === 1) {                // 64-bit extended size
      if (i + 16 > end) break;
      // Only low 32 bits matter for our 2 MB window
      size = readU32BE(buf, i + 12);
    }
    if (size < 8 || i + size > end + 1_000_000) break; // sanity guard

    cb(boxType, i, i + 8, Math.min(size, end - i));
    i += size;
  }
}

export async function parseVideoMeta(file: File): Promise<VideoMeta> {
  const result: VideoMeta = {
    codec: 'unknown', width: null, height: null,
    fps: null, hasEmbeddedGPS: false, recordedAt: null,
  };

  try {
    const readSize = Math.min(2_097_152, file.size); // first 2 MB
    const buf = new Uint8Array(await file.slice(0, readSize).arrayBuffer());

    // ── Embedded GPS telemetry (GPMF / GoPro) ────────────────────────────────
    result.hasEmbeddedGPS = hasTag(buf, 'gpmd');

    // ── Walk top-level boxes to find moov ────────────────────────────────────
    let moovStart = -1, moovEnd = -1;
    walkBoxes(buf, 0, buf.length, (type, boxStart, _, size) => {
      if (type === 'moov') { moovStart = boxStart; moovEnd = boxStart + size; }
    });

    // ── Codec detection — scan ONLY within moov to avoid mdat false-positives ──
    // Scanning the full 2 MB buffer hits raw mdat video frames, which can
    // coincidentally contain HEVC fourcc byte sequences inside H.264 entropy-coded
    // content, causing H.264 files to be misreported as HEVC.
    if (moovStart >= 0) {
      const moov = buf.subarray(moovStart, moovEnd);
      if (hasTag(moov, 'hvc1') || hasTag(moov, 'hev1') || hasTag(moov, 'dvhe')) {
        result.codec = 'hevc';
      } else if (hasTag(moov, 'avc1') || hasTag(moov, 'H264') || hasTag(moov, 'avc3')) {
        result.codec = 'h264';
      }
    } else {
      // moov not in first 2 MB (non-faststart GoPro) — scan only the ftyp box
      // which is always at the start and contains a safe, small amount of data.
      const ftyp = buf.subarray(0, Math.min(256, buf.length));
      if (hasTag(ftyp, 'hvc1') || hasTag(ftyp, 'hev1') || hasTag(ftyp, 'dvhe')) {
        result.codec = 'hevc';
      } else if (hasTag(ftyp, 'avc1') || hasTag(ftyp, 'H264') || hasTag(ftyp, 'avc3')) {
        result.codec = 'h264';
      }
      return result; // moov not in first 2 MB — resolution/fps/recordedAt unavailable
    }

    // ── Parse mvhd (movie header) ─────────────────────────────────────────────
    walkBoxes(buf, moovStart + 8, moovEnd, (type, _, cs) => {
      if (type !== 'mvhd') return;
      const version = buf[cs];
      const timeOffset = version === 1 ? 4 : 4;         // same for both (flags = 3 bytes)
      // version 0: creation_time = uint32 at cs+4
      // version 1: creation_time = uint64 at cs+4 (we only read low 32 bits — safe until 2038 + offset)
      const creationRaw = version === 1
        ? readU32BE(buf, cs + 8)   // low 32 bits of uint64
        : readU32BE(buf, cs + timeOffset);
      const unixSec = creationRaw - APPLE_EPOCH_OFFSET;
      if (unixSec > 0 && unixSec < 4_102_444_800) { // sanity: 2000–2100
        result.recordedAt = new Date(unixSec * 1000).toISOString();
      }
    });

    // ── Walk trak boxes for video track ──────────────────────────────────────
    let mdhd_timescale: number | null = null;

    walkBoxes(buf, moovStart + 8, moovEnd, (type, boxStart, _, size) => {
      if (type !== 'trak') return;
      const trakEnd = boxStart + size;

      // tkhd — track header with width/height
      walkBoxes(buf, boxStart + 8, trakEnd, (t, _, cs, _s) => {
        if (t !== 'tkhd') return;
        const v = buf[cs];
        // width/height are fixed-point 16.16 — last 8 bytes of tkhd content
        // Version 0: content length = 84 bytes, v1 = 96
        const wOffset = cs + (v === 1 ? 88 : 76);
        const hOffset = wOffset + 4;
        if (hOffset + 4 <= buf.length) {
          const w = readU32BE(buf, wOffset) >> 16;
          const h = readU32BE(buf, hOffset) >> 16;
          if (w > 0 && h > 0 && w < 10_000 && h < 10_000) {
            result.width  = w;
            result.height = h;
          }
        }
      });

      // mdia → mdhd (timescale) + stbl → stts (sample delta → fps)
      walkBoxes(buf, boxStart + 8, trakEnd, (t, mboxStart, _, msize) => {
        if (t !== 'mdia') return;
        const mdiaEnd = mboxStart + msize;

        walkBoxes(buf, mboxStart + 8, mdiaEnd, (mt, _, cs) => {
          if (mt === 'mdhd') {
            const v = buf[cs];
            mdhd_timescale = readU32BE(buf, cs + (v === 1 ? 20 : 12));
          }
        });

        // minf → stbl → stts
        walkBoxes(buf, mboxStart + 8, mdiaEnd, (mt, minfStart, _, minfSize) => {
          if (mt !== 'minf') return;
          const minfEnd = minfStart + minfSize;
          walkBoxes(buf, minfStart + 8, minfEnd, (st, stblStart, _, stblSize) => {
            if (st !== 'stbl') return;
            const stblEnd = stblStart + stblSize;
            walkBoxes(buf, stblStart + 8, stblEnd, (stt, _, cs) => {
              if (stt !== 'stts' || mdhd_timescale == null) return;
              // stts: version(4) + entry_count(4) + [count(4) + delta(4)]*
              const entryCount = readU32BE(buf, cs + 4);
              if (entryCount > 0 && cs + 16 <= buf.length) {
                const sampleDelta = readU32BE(buf, cs + 12); // first entry delta
                if (sampleDelta > 0) {
                  result.fps = Math.round((mdhd_timescale! / sampleDelta) * 10) / 10;
                }
              }
            });
          });
        });
      });
    });

  } catch {
    // Parsing failures are non-fatal — return whatever we have
  }

  return result;
}
