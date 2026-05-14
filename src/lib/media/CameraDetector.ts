/**
 * CameraDetector — identifies the camera type from a video file.
 *
 * Detection is done in two layers:
 *   1. Filename pattern (fast, synchronous) — covers 90% of cases
 *   2. EXIF Make/Model via exifr (authoritative, reads file header)
 *
 * Adding a new camera in the future: add a pattern to FILENAME_PATTERNS
 * and a Make string to EXIF_MAKE_MAP. The rest of the pipeline picks it up
 * via the CameraType union.
 *
 * Supported types:
 *   'gopro'   → GoPro cameras (GPMF pipeline)
 *   'iphone'  → Apple iPhone (QuickTime/timestamp pipeline)
 *   'unknown' → Camera not yet supported — upload is rejected with an explanation
 */

export type CameraType = 'gopro' | 'iphone' | 'android' | 'unknown';

export interface CameraDetection {
  type: CameraType;
  make: string;   // e.g. "GoPro", "Apple", "Samsung"
  model: string;  // e.g. "HERO12 Black", "iPhone 15 Pro", "Galaxy S24 FE"
}

// ── Filename pattern registry ─────────────────────────────────────────────────
// Each entry is [regex, CameraType]. First match wins.
const FILENAME_PATTERNS: [RegExp, CameraType][] = [
  [/^(GH|GX|GL|GOPR|GP)\d/i,           'gopro'],
  [/^IMG_\d{4}\.(MOV|mov)$/,            'iphone'],
  // Android / Samsung: YYYYMMDD_HHMMSS.mp4 or VID_YYYYMMDD_HHMMSS.mp4
  [/^\d{8}_\d{6}\.(mp4|MP4)$/,          'android'],
  [/^VID_\d{8}_\d{6}\.(mp4|MP4)$/,      'android'],
];

// Extension-based fallback (lower confidence than filename pattern)
const EXT_DEFAULTS: Record<string, CameraType> = {
  mp4: 'gopro',
  mov: 'iphone',
};

// ── EXIF Make → CameraType map ────────────────────────────────────────────────
// Keys are lowercase substrings of the Make tag value.
const EXIF_MAKE_MAP: [string, CameraType, string][] = [
  // [substring, type, normalized make]
  ['gopro',    'gopro',    'GoPro'],
  ['apple',    'iphone',  'Apple'],
  ['samsung',  'android', 'Samsung'],
  ['huawei',   'android', 'Huawei'],
  ['xiaomi',   'android', 'Xiaomi'],
  ['google',   'android', 'Google'],
  ['motorola', 'android', 'Motorola'],
  ['oneplus',  'android', 'OnePlus'],
  ['oppo',     'android', 'OPPO'],
  ['dji',      'unknown', 'DJI'],
  ['insta',    'unknown', 'Insta360'],
];

export class CameraDetector {
  /**
   * Fast synchronous detection from filename alone.
   * Returns null when no confident match is found.
   */
  static fromFilename(filename: string): CameraType | null {
    for (const [pattern, type] of FILENAME_PATTERNS) {
      if (pattern.test(filename)) return type;
    }
    return null;
  }

  /**
   * Full detection: filename → extension → EXIF (last resort only).
   *
   * Order matters for performance: filename and extension checks are synchronous
   * and do zero I/O. EXIF reading via exifr is deferred to the end because for
   * iPhone MOV files exifr scans large portions of the file on the main thread
   * before throwing "Unknown file format" (QuickTime 'qt  ' brand is not supported
   * by exifr 7.x) — this blocks the browser and causes visible lag across the page.
   *
   * Always resolves — never rejects.
   */
  static async detect(file: File): Promise<CameraDetection> {
    // ── Layer 1: filename pattern (zero I/O, covers GoPro naming + iPhone IMG_XXXX) ─
    for (const [pattern, type] of FILENAME_PATTERNS) {
      if (pattern.test(file.name)) {
        return { type, make: type === 'gopro' ? 'GoPro' : 'Apple', model: '' };
      }
    }

    // ── Layer 2: extension fallback — only for unambiguous extensions ────────
    // .mov → iPhone (only Apple uses QuickTime brand)
    // .mp4 → skip here; without a filename pattern match an MP4 could be
    //        Android or GoPro — defer to EXIF (Layer 3) for confirmation.
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'mov') {
      return { type: 'iphone', make: 'Apple', model: '' };
    }

    // ── Layer 3: EXIF Make/Model (last resort — reads file, main thread) ────────
    // Only reached for files that are neither .mp4/.mov nor match known filename
    // patterns. In practice this path should never fire for GoPro or iPhone.
    try {
      const exifr = await import('exifr');
      const opts: Record<string, any> = {
        quicktime:       true,
        tiff:            true,
        exif:            false,
        gps:             false,
        ifd0:            true,
        mergeOutput:     true,
        translateKeys:   true,
        translateValues: false,
      };
      const tags = await exifr.parse(file, opts) as Record<string, any> | undefined;

      if (tags) {
        const make   = String(tags.Make  || tags.make  || '').trim();
        const model  = String(tags.Model || tags.model || '').trim();
        const makeLc = make.toLowerCase();

        for (const [substr, type, normalizedMake] of EXIF_MAKE_MAP) {
          if (makeLc.includes(substr)) {
            return { type, make: make || normalizedMake, model };
          }
        }
      }
    } catch {
      // exifr read failed — fall through to unknown
    }

    return { type: 'unknown', make: '', model: '' };
  }
}
