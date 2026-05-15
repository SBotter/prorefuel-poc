/**
 * Mobile device + browser capability detection for the LENS WebCodecs pipeline.
 *
 * iOS 16.4+ → VideoEncoder available (H264 video, no AudioEncoder until Safari 26).
 * Android Chrome 94+ → Full WebCodecs support.
 * All browsers on iOS use WebKit — "browser" does not matter, only iOS version.
 */

export interface MobileCapabilities {
  isMobileDevice: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  iosVersion: number | null;      // e.g. 17.4
  androidVersion: number | null;
  supportsVideoEncoder: boolean;
  isSupported: boolean;
  blockedReason: string | null;
}

const IOS_MIN_VERSION = 16.4;

export function getMobileCapabilities(): MobileCapabilities {
  if (typeof navigator === 'undefined') return _unsupported(false, false, null, null);

  const ua = navigator.userAgent;
  const isIOS     = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua) && !isIOS;

  if (!isIOS && !isAndroid) {
    return {
      isMobileDevice: false, isIOS: false, isAndroid: false,
      iosVersion: null, androidVersion: null,
      supportsVideoEncoder: typeof (window as any).VideoEncoder !== 'undefined',
      isSupported: true, blockedReason: null,
    };
  }

  const supportsVideoEncoder = typeof (window as any).VideoEncoder !== 'undefined';

  // ── iOS ────────────────────────────────────────────────────────────────────
  if (isIOS) {
    let iosVersion: number | null = null;
    const m = ua.match(/OS (\d+)[_.](\d+)/i);
    if (m) iosVersion = parseFloat(`${m[1]}.${m[2]}`);

    if (iosVersion !== null && iosVersion < IOS_MIN_VERSION) {
      return _unsupported(true, false, iosVersion, null,
        `iOS ${IOS_MIN_VERSION}+ is required. Your device runs iOS ${iosVersion}. Please update to continue.`);
    }
    if (!supportsVideoEncoder) {
      return _unsupported(true, false, iosVersion, null,
        'Please update Safari to the latest version to use LENS.');
    }
    return {
      isMobileDevice: true, isIOS: true, isAndroid: false,
      iosVersion, androidVersion: null, supportsVideoEncoder: true,
      isSupported: true, blockedReason: null,
    };
  }

  // ── Android ────────────────────────────────────────────────────────────────
  let androidVersion: number | null = null;
  const ma = ua.match(/Android (\d+(?:\.\d+)?)/i);
  if (ma) androidVersion = parseFloat(ma[1]);

  if (!supportsVideoEncoder) {
    return _unsupported(false, true, null, androidVersion,
      'LENS requires Chrome 94 or later on Android. Please update your browser.');
  }
  return {
    isMobileDevice: true, isIOS: false, isAndroid: true,
    iosVersion: null, androidVersion, supportsVideoEncoder: true,
    isSupported: true, blockedReason: null,
  };
}

function _unsupported(
  isIOS: boolean, isAndroid: boolean,
  iosVersion: number | null, androidVersion: number | null,
  reason?: string,
): MobileCapabilities {
  return {
    isMobileDevice: true, isIOS, isAndroid,
    iosVersion, androidVersion, supportsVideoEncoder: false,
    isSupported: false, blockedReason: reason ?? null,
  };
}
