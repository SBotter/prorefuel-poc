/**
 * CameraDetector — identifies the camera type from a video file.
 *
 * Detection order (content-first, filename last resort):
 *   0. WhatsApp beam box — proprietary box written by WA between ftyp and moov.
 *      Fastest check (~200 bytes). Runs before EXIF to short-circuit early.
 *   1. Extension: .mov → iPhone (unambiguous — only Apple uses QuickTime MOV)
 *   2. EXIF Make/Model — reads actual file content (Make tag)
 *   3a. Apple MP4 container scan — 'com.apple.quicktime.*' metadata
 *       Override: if WA structure is also present → WhatsApp wins (mobile saves
 *       WA videos to iOS camera roll and iOS adds apple metadata on top)
 *   3b. Android MP4 container scan — 'com.android.*' metadata
 *       Override: same as 3a — Android gallery can wrap WA files with its metadata
 *   3c. WhatsApp structure fallback — for cases where beam was stripped AND no
 *       Apple/Android metadata was added. Detects: mp42 brand + mvhd.creation_time=0.
 *       WhatsApp always zeroes out the recording timestamp for privacy. Real
 *       camera recordings (iPhone, Android, GoPro) always embed a valid timestamp.
 *   4. Filename patterns — last resort only, for GoPro naming convention
 *
 * The filename is NEVER used as authoritative source. Users can rename files
 * freely. Only file content determines the camera type.
 *
 * Supported types:
 *   'gopro'     → GoPro cameras (GPMF telemetry pipeline)
 *   'iphone'    → Apple iPhone (CreateDate timestamp pipeline)
 *   'android'   → Android phones (Samsung, Google Pixel, etc.)
 *   'whatsapp'  → WhatsApp-shared video (portrait template, GPX-only pipeline)
 *   'unknown'   → Not supported — upload is rejected with explanation
 */

export type CameraType = 'gopro' | 'iphone' | 'android' | 'whatsapp' | 'unknown';

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

    // ── Layer 0: WhatsApp beam box scan (MP4 and MOV, reads first 200 bytes) ──
    // WhatsApp writes a proprietary 'beam' box between ftyp and moov.
    // Critically, WhatsApp on iOS saves the EXACT same mp42 container regardless
    // of whether the file extension is .mp4 or .mov — same bytes, different name.
    // This check must run BEFORE the Layer 1 MOV→iPhone fast-path so that a WA
    // video saved as .mov is correctly identified instead of misidentified as iPhone.
    if (ext === 'mp4' || ext === 'mov') {
      const isWA = await CameraDetector._detectBeamBox(file);
      if (isWA) return { type: 'whatsapp', make: 'WhatsApp', model: 'WhatsApp' };
    }

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
    // rawExifMake/rawExifModel are preserved even when brand is not in our map
    // so the caller can log them as demand signals for unsupported cameras.
    let rawExifMake  = '';
    let rawExifModel = '';
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
        rawExifMake  = String(tags.Make  || tags.make  || '').trim();
        rawExifModel = String(tags.Model || tags.model || '').trim();
        const makeLc = rawExifMake.toLowerCase();

        for (const [substr, type, normalizedMake] of EXIF_MAKE_MAP) {
          if (makeLc.includes(substr)) {
            return { type, make: rawExifMake || normalizedMake, model: rawExifModel };
          }
        }
        // Brand not in map — rawExifMake/rawExifModel preserved for fallback return
      }
    } catch { /* exifr failed — continue to next layer */ }

    // ── Layer 3a: Apple iPhone MP4 container scan ────────────────────────────
    // iPhones that record or export as .mp4 embed com.apple.quicktime.* metadata.
    // Override: on mobile, iOS adds apple metadata when saving a WA video to the
    // camera roll. WA structure check (mp42 + ct=0) wins over apple detection.
    const appleResult = await CameraDetector._scanAppleContainer(file);
    if (appleResult) {
      if (await CameraDetector._isWhatsAppStructure(file))
        return { type: 'whatsapp', make: 'WhatsApp', model: 'WhatsApp' };
      return appleResult;
    }

    // ── Layer 3b: Android MP4 container byte scan (reads file content) ────────
    // Android writes 'com.android.*' proprietary metadata into the MP4 container.
    // Override: Android gallery can wrap a received WA video with android metadata
    // while the file itself is still WhatsApp-transcoded (mp42 + ct=0).
    const androidResult = await CameraDetector._scanAndroidContainer(file);
    if (androidResult) {
      if (await CameraDetector._isWhatsAppStructure(file))
        return { type: 'whatsapp', make: 'WhatsApp', model: 'WhatsApp' };
      return androidResult;
    }

    // ── Layer 3c: WhatsApp structure fallback ─────────────────────────────────
    // Catches WA videos where beam was stripped AND no Apple/Android metadata was
    // added. mp42 brand + mvhd.creation_time=0 is a reliable WA fingerprint:
    // every real camera (iPhone, Android, GoPro) embeds a valid creation_time.
    if (await CameraDetector._isWhatsAppStructure(file))
      return { type: 'whatsapp', make: 'WhatsApp', model: 'WhatsApp' };

    // ── Layer 4: GoPro filename pattern (last resort — content checks failed) ──
    // GoPro's internal naming (GH/GX/GL/GOPR/GP + digits) is camera-generated
    // and extremely specific. If EXIF failed but filename looks like GoPro,
    // treat it as GoPro — the worker will verify via GPMF and fail clearly if not.
    if (GOPRO_FILENAME.test(file.name)) {
      return { type: 'gopro', make: 'GoPro', model: '' };
    }

    // Return whatever EXIF told us even if the camera is unsupported.
    // This lets callers log the raw make/model as a demand signal.
    return { type: 'unknown', make: rawExifMake, model: rawExifModel };
  }

  // ── WhatsApp beam box detection ──────────────────────────────────────────────
  // Reads only the first 200 bytes of the file. Walks top-level MP4 box headers
  // (8 bytes each) looking for a box whose type is 'beam'. Stops at 'moov' because
  // the beam box always appears between ftyp and moov — if moov is reached without
  // finding beam, it is not a WhatsApp file.
  private static async _detectBeamBox(file: File): Promise<boolean> {
    try {
      const buf = await file.slice(0, 200).arrayBuffer();
      const d   = new Uint8Array(buf);
      let pos   = 0;
      for (let i = 0; i < 8 && pos + 8 <= d.length; i++) {
        const size = ((d[pos] << 24) | (d[pos + 1] << 16) | (d[pos + 2] << 8) | d[pos + 3]) >>> 0;
        const type = String.fromCharCode(d[pos + 4], d[pos + 5], d[pos + 6], d[pos + 7]);
        if (type === 'beam') return true;
        if (type === 'moov' || size < 8) break;
        pos += size;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ── WhatsApp structure fingerprint (beam-independent) ────────────────────────
  // Conditions: (1) ftyp major brand = 'mp42'  AND  (2) mvhd.creation_time = 0.
  // WhatsApp zeroes the creation_time on every transcoded video for privacy.
  // Real camera recordings always embed a valid UTC timestamp in mvhd.
  // Reads first 64 KB (moov is at file start for faststart/WA files).
  private static async _isWhatsAppStructure(file: File): Promise<boolean> {
    try {
      const buf = new Uint8Array(await file.slice(0, 65_536).arrayBuffer());
      if (buf.length < 12) return false;

      // Check ftyp major brand = 'mp42'
      const ftypSz = ((buf[0]<<24)|(buf[1]<<16)|(buf[2]<<8)|buf[3]) >>> 0;
      if (String.fromCharCode(buf[4], buf[5], buf[6], buf[7]) !== 'ftyp') return false;
      if (String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) !== 'mp42') return false;

      // Walk top-level boxes to find moov, then mvhd
      let pos = ftypSz;
      for (let i = 0; i < 16 && pos + 8 <= buf.length; i++) {
        const sz   = ((buf[pos]<<24)|(buf[pos+1]<<16)|(buf[pos+2]<<8)|buf[pos+3]) >>> 0;
        const type = String.fromCharCode(buf[pos+4], buf[pos+5], buf[pos+6], buf[pos+7]);
        if (sz < 8) break;

        if (type === 'moov') {
          let mp  = pos + 8;
          const end = Math.min(pos + sz, buf.length);
          for (let j = 0; j < 16 && mp + 8 <= end; j++) {
            const msz  = ((buf[mp]<<24)|(buf[mp+1]<<16)|(buf[mp+2]<<8)|buf[mp+3]) >>> 0;
            const mtyp = String.fromCharCode(buf[mp+4], buf[mp+5], buf[mp+6], buf[mp+7]);
            if (mtyp === 'mvhd') {
              // mvhd layout (after 8-byte box header):
              //   [0]     version
              //   [1-3]   flags
              //   [4-7]   creation_time (version 0, Mac epoch) — 0 = stripped
              //   [4-11]  creation_time (version 1, Mac epoch, 64-bit)
              if (mp + 16 > end) return false;
              const version = buf[mp + 8];
              if (version === 0) {
                const ct = ((buf[mp+12]<<24)|(buf[mp+13]<<16)|(buf[mp+14]<<8)|buf[mp+15]) >>> 0;
                return ct === 0;
              }
              if (version === 1 && mp + 24 <= end) {
                const hi = ((buf[mp+12]<<24)|(buf[mp+13]<<16)|(buf[mp+14]<<8)|buf[mp+15]) >>> 0;
                const lo = ((buf[mp+16]<<24)|(buf[mp+17]<<16)|(buf[mp+18]<<8)|buf[mp+19]) >>> 0;
                return hi === 0 && lo === 0;
              }
              return false;
            }
            if (msz < 8) break;
            mp += msz;
          }
          return false;
        }

        pos += sz;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ── Apple iPhone container scan ──────────────────────────────────────────────
  // iPhone MP4 files (exported from Photos, HEVC→H264 conversions, shared via
  // AirDrop, or recorded in "Most Compatible" mode) always contain
  // 'com.apple.quicktime' metadata keys in the moov box, regardless of filename.
  private static async _scanAppleContainer(file: File): Promise<CameraDetection | null> {
    const decode   = (b: ArrayBuffer) => new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(b));
    const scanText = (text: string): CameraDetection | null => {
      if (!text.includes('com.apple.quicktime')) return null;
      // Extract model from com.apple.quicktime.model if present
      const model = text.match(/com\.apple\.quicktime\.model\0{0,8}([A-Za-z0-9, ]{2,20})/)?.[1]?.trim() || '';
      return { type: 'iphone', make: 'Apple', model };
    };
    try {
      const head = await file.slice(0, 65_536).arrayBuffer();
      const r1   = scanText(decode(head));
      if (r1) return r1;
      const tailSize = Math.min(262_144, file.size);
      const tail     = await file.slice(file.size - tailSize).arrayBuffer();
      return scanText(decode(tail));
    } catch {
      return null;
    }
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
