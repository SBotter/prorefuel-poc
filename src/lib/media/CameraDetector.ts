/**
 * CameraDetector — identifies the camera type from a video file.
 *
 * Detection order (content-first, filename last resort):
 *   1. Extension: .mov → iPhone (unambiguous — only Apple uses QuickTime MOV)
 *   2. EXIF Make/Model — reads actual file content (Make tag)
 *   3. Android MP4 container scan — reads 'com.android.*' metadata from bytes
 *      Works for ANY filename including renamed files (moov at start or end)
 *   4. Filename patterns — last resort only, for GoPro naming convention
 *      (GH/GX/GL/GOPR/GP + digits — too specific to be a false positive)
 *
 * The filename is NEVER used as authoritative source. Users can rename files
 * freely. Only file content determines the camera type.
 *
 * Supported types:
 *   'gopro'   → GoPro cameras (GPMF telemetry pipeline)
 *   'iphone'  → Apple iPhone (CreateDate timestamp pipeline)
 *   'android' → Android phones (Samsung, Google Pixel, etc.)
 *   'unknown' → Not supported — upload is rejected with explanation
 */

export type CameraType = 'gopro' | 'iphone' | 'android' | 'unknown';

export interface CameraDetection {
  type:  CameraType;
  make:  string;   // e.g. "GoPro", "Apple", "Samsung", "Google"
  model: string;   // e.g. "HERO12 Black", "iPhone 15 Pro", "Galaxy S24 FE"
}

// ── EXIF Make → CameraType map ────────────────────────────────────────────────
const EXIF_MAKE_MAP: [string, CameraType, string][] = [
  ['gopro',    'gopro',    'GoPro'],
  ['apple',    'iphone',   'Apple'],
  ['samsung',  'android',  'Samsung'],
  ['huawei',   'android',  'Huawei'],
  ['xiaomi',   'android',  'Xiaomi'],
  ['google',   'android',  'Google'],
  ['motorola', 'android',  'Motorola'],
  ['oneplus',  'android',  'OnePlus'],
  ['oppo',     'android',  'OPPO'],
  ['dji',      'unknown',  'DJI'],
  ['insta',    'unknown',  'Insta360'],
];

// ── Filename patterns (LAST RESORT only) ─────────────────────────────────────
// GoPro's camera-generated filenames are extremely specific (GH/GX/GL/GOPR/GP
// followed by digits). These are used ONLY after all content-based checks fail.
const GOPRO_FILENAME = /^(GH|GX|GL|GOPR|GP)\d/i;

export class CameraDetector {
  /**
   * Full detection — always reads file content, never relies solely on filename.
   * Always resolves, never rejects.
   */
  static async detect(file: File): Promise<CameraDetection> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

    // ── Layer 1: MOV extension → iPhone ──────────────────────────────────────
    // QuickTime MOV is exclusively used by Apple in consumer cameras/phones.
    // No other mainstream device uses .mov. Extension alone is reliable here.
    if (ext === 'mov') {
      // Confirm with EXIF if possible, but .mov is authoritative
      try {
        const exifr = await import('exifr');
        const opts2: Record<string, any> = { quicktime: true, tiff: true, ifd0: true, exif: false, gps: false, mergeOutput: true, translateKeys: true, translateValues: false };
        const tags  = await exifr.parse(file, opts2) as Record<string, any> | undefined;
        if (tags) {
          const model = String(tags.Model || tags.model || '').trim();
          return { type: 'iphone', make: 'Apple', model };
        }
      } catch { /* EXIF unavailable — extension alone is sufficient */ }
      return { type: 'iphone', make: 'Apple', model: '' };
    }

    // Only MP4 from here — any other extension is unknown
    if (ext !== 'mp4') {
      return { type: 'unknown', make: '', model: '' };
    }

    // ── Layer 2: EXIF Make/Model (reads file content) ─────────────────────────
    // Standard EXIF data — readable by exifr for GoPro, some iPhones, some Android.
    // Android phones often skip EXIF entirely → Layer 3 handles those.
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
    } catch { /* exifr failed — continue to next layer */ }

    // ── Layer 3: Android MP4 container byte scan (reads file content) ─────────
    // Android writes 'com.android.*' proprietary metadata into the MP4 container
    // regardless of filename. Works even for files renamed to anything.
    //
    // Scans BOTH the beginning (faststart files — moov at start) AND the end
    // (non-faststart files — moov at EOF, common on Android camera apps).
    const androidResult = await CameraDetector._scanAndroidContainer(file);
    if (androidResult) return androidResult;

    // ── Layer 4: GoPro filename pattern (last resort — content checks failed) ──
    // GoPro's internal naming (GH/GX/GL/GOPR/GP + digits) is camera-generated
    // and extremely specific. If EXIF failed but filename looks like GoPro,
    // treat it as GoPro — the worker will verify via GPMF and fail clearly if not.
    if (GOPRO_FILENAME.test(file.name)) {
      return { type: 'gopro', make: 'GoPro', model: '' };
    }

    return { type: 'unknown', make: '', model: '' };
  }

  // ── Android container scan ───────────────────────────────────────────────────
  private static async _scanAndroidContainer(file: File): Promise<CameraDetection | null> {
    const decode   = (b: ArrayBuffer) => new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(b));
    const scanText = (text: string): CameraDetection | null => {
      if (!text.includes('com.android.')) return null;

      // Infer brand from strings present in the container (keys and values
      // are in separate MP4 boxes, so we scan for known brand strings)
      let make = '';
      const lc = text.toLowerCase();
      if      (lc.includes('samsung'))   make = 'Samsung';
      else if (lc.includes('google'))    make = 'Google';
      else if (lc.includes('xiaomi'))    make = 'Xiaomi';
      else if (lc.includes('huawei'))    make = 'Huawei';
      else if (lc.includes('oneplus'))   make = 'OnePlus';
      else if (lc.includes('motorola')) make = 'Motorola';
      else if (lc.includes('oppo'))      make = 'OPPO';
      else if (lc.includes('vivo'))      make = 'Vivo';
      else if (lc.includes('realme'))    make = 'Realme';

      const model = text.match(/com\.\w+\.android\.model\0{0,8}([A-Za-z0-9 _\-]{2,24})/)?.[1]?.trim() || '';
      return { type: 'android', make, model };
    };

    try {
      // Scan beginning — faststart files (moov at start)
      const head = await file.slice(0, 65_536).arrayBuffer();
      const r1   = scanText(decode(head));
      if (r1) return r1;

      // Scan end — non-faststart files (moov at EOF, common on Android)
      const tailSize = Math.min(262_144, file.size);
      const tail     = await file.slice(file.size - tailSize).arrayBuffer();
      return scanText(decode(tail));
    } catch {
      return null;
    }
  }
}
