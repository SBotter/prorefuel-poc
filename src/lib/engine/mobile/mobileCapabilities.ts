/**
 * Mobile device + browser capability detection for the LENS WebCodecs pipeline.
 *
 * iOS 16.4+ (any browser — all use WebKit on iOS, version is what matters)
 * Android Chrome 94+ (WebCodecs requires Chrome — Firefox/Samsung Internet unsupported)
 */

export interface MobileCapabilities {
  isMobileDevice: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  iosVersion: number | null;
  androidVersion: number | null;
  isChrome: boolean;
  supportsVideoEncoder: boolean;
  isSupported: boolean;
  blockedReason: string | null;
}

const IOS_MIN_VERSION     = 16.4;
const ANDROID_MIN_CHROME  = 94;

export function getMobileCapabilities(): MobileCapabilities {
  if (typeof navigator === 'undefined') return _unsupported(false, false, null, null);

  const ua = navigator.userAgent;
  const isIOS     = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua) && !isIOS;

  // ── Non-mobile (desktop or unknown) — pass-through ──────────────────────
  if (!isIOS && !isAndroid) {
    return {
      isMobileDevice: false, isIOS: false, isAndroid: false,
      iosVersion: null, androidVersion: null, isChrome: false,
      supportsVideoEncoder: typeof (window as any).VideoEncoder !== 'undefined',
      isSupported: true, blockedReason: null,
    };
  }

  const supportsVideoEncoder = typeof (window as any).VideoEncoder !== 'undefined';

  // ── iOS ────────────────────────────────────────────────────────────────────
  // All iOS browsers (Chrome, Firefox, Edge) use WebKit — version determines capability.
  if (isIOS) {
    let iosVersion: number | null = null;
    const m = ua.match(/OS (\d+)[_.](\d+)/i);
    if (m) iosVersion = parseFloat(`${m[1]}.${m[2]}`);

    if (iosVersion !== null && iosVersion < IOS_MIN_VERSION) {
      return _unsupported(true, false, iosVersion, null,
        `iOS ${IOS_MIN_VERSION}+ required. Your device runs iOS ${iosVersion}. Update in Settings → General → Software Update.`);
    }
    if (!supportsVideoEncoder) {
      return _unsupported(true, false, iosVersion, null,
        'Please update Safari to the latest version to use LENS.');
    }
    return {
      isMobileDevice: true, isIOS: true, isAndroid: false,
      iosVersion, androidVersion: null, isChrome: false,
      supportsVideoEncoder: true, isSupported: true, blockedReason: null,
    };
  }

  // ── Android ────────────────────────────────────────────────────────────────
  // WebCodecs requires Chrome. Firefox, Samsung Internet, and other Android browsers
  // do NOT support VideoEncoder. We detect Chrome via the Chrome token in UA.
  let androidVersion: number | null = null;
  const ma = ua.match(/Android (\d+(?:\.\d+)?)/i);
  if (ma) {
    const v = parseFloat(ma[1]);
    if (v > 0 && v < 99) androidVersion = v; // guard against malformed UA
  }

  // Chromium-based browsers on Android support WebCodecs.
  // Supported: Chrome, Edge, Brave, Arc, Vivaldi, Opera (Chromium version)
  // NOT supported: Firefox, Samsung Internet, Opera Mini (non-Chromium)
  const chromiumMatch   = ua.match(/Chrome\/(\d+)/i);
  const isChromiumBased = !!chromiumMatch && !/SamsungBrowser|Firefox/i.test(ua);
  const chromeVersion   = chromiumMatch ? parseInt(chromiumMatch[1], 10) : 0;

  if (!isChromiumBased) {
    return _unsupported(false, true, null, androidVersion,
      'LENS requires Chrome (or a Chromium-based browser) on Android. Open this page in Chrome to continue.');
  }

  if (chromeVersion > 0 && chromeVersion < ANDROID_MIN_CHROME) {
    return _unsupported(false, true, null, androidVersion,
      `Your browser (Chromium ${chromeVersion}) is too old. Update Chrome in the Play Store (requires version ${ANDROID_MIN_CHROME}+).`);
  }

  if (!supportsVideoEncoder) {
    return _unsupported(false, true, null, androidVersion,
      `LENS requires Chrome ${ANDROID_MIN_CHROME}+ on Android. Update Chrome in the Play Store.`);
  }

  return {
    isMobileDevice: true, isIOS: false, isAndroid: true,
    iosVersion: null, androidVersion, isChrome: isChromiumBased,
    supportsVideoEncoder: true, isSupported: true, blockedReason: null,
  };
}

function _unsupported(
  isIOS: boolean, isAndroid: boolean,
  iosVersion: number | null, androidVersion: number | null,
  reason?: string,
): MobileCapabilities {
  return {
    isMobileDevice: true, isIOS, isAndroid,
    iosVersion, androidVersion, isChrome: false,
    supportsVideoEncoder: false, isSupported: false, blockedReason: reason ?? null,
  };
}
