/**
 * browserInfo — extracts structured OS / browser / device info from the client.
 *
 * Priority:
 *   1. navigator.userAgentData (Chrome 90+, Edge 90+) — structured, accurate.
 *   2. navigator.userAgent string regex fallback — works in all browsers.
 *
 * Returns synchronously with whatever is available.  Never throws.
 */

export interface BrowserInfo {
  os:             string | null;   // 'Windows', 'macOS', 'iOS', 'Android', 'Linux'
  os_version:     string | null;   // '11', '14.5', '17.2', '16'
  browser:        string | null;   // 'Chrome', 'Safari', 'Firefox', 'Edge'
  browser_version: string | null;  // '125.0.6422.113'
  is_mobile:      boolean;
  device_model:   string | null;   // 'Galaxy S24 FE' (Android only, high-entropy)
}

// ── User-Agent string fallback ────────────────────────────────────────────────

function parseUA(ua: string): BrowserInfo {
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

  let os: string | null = null;
  let os_version: string | null = null;
  let browser: string | null = null;
  let browser_version: string | null = null;

  // OS detection
  if (/Windows NT (\d+\.\d+)/i.test(ua)) {
    os = 'Windows';
    const nt: Record<string, string> = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    os_version = nt[RegExp.$1] ?? RegExp.$1;
  } else if (/Mac OS X ([\d_]+)/i.test(ua)) {
    os = 'macOS';
    os_version = RegExp.$1.replace(/_/g, '.');
  } else if (/iPhone OS ([\d_]+)/i.test(ua) || /CPU OS ([\d_]+)/i.test(ua)) {
    os = 'iOS';
    os_version = RegExp.$1.replace(/_/g, '.');
  } else if (/Android ([\d.]+)/i.test(ua)) {
    os = 'Android';
    os_version = RegExp.$1;
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  }

  // Browser detection (order matters: check Edge/OPR before Chrome)
  if (/Edg\/([\d.]+)/i.test(ua)) {
    browser = 'Edge'; browser_version = RegExp.$1;
  } else if (/OPR\/([\d.]+)/i.test(ua) || /Opera\/([\d.]+)/i.test(ua)) {
    browser = 'Opera'; browser_version = RegExp.$1;
  } else if (/Chrome\/([\d.]+)/i.test(ua) && !/Chromium/i.test(ua)) {
    browser = 'Chrome'; browser_version = RegExp.$1;
  } else if (/Firefox\/([\d.]+)/i.test(ua)) {
    browser = 'Firefox'; browser_version = RegExp.$1;
  } else if (/Safari\/([\d.]+)/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = 'Safari'; browser_version = RegExp.$1;
  }

  return { os, os_version, browser, browser_version, is_mobile: mobile, device_model: null };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns structured browser/OS info synchronously from the User-Agent string.
 * Call `enrichWithHighEntropy()` afterwards if you need the device model on Android.
 */
export function getBrowserInfo(): BrowserInfo {
  if (typeof navigator === 'undefined') {
    return { os: null, os_version: null, browser: null, browser_version: null, is_mobile: false, device_model: null };
  }
  return parseUA(navigator.userAgent);
}

/**
 * Attempts to enrich with high-entropy values (Chrome 90+: platform version, device model).
 * Returns a resolved BrowserInfo — never rejects.
 */
export async function getBrowserInfoEnriched(): Promise<BrowserInfo> {
  const base = getBrowserInfo();
  try {
    // navigator.userAgentData is available in Chrome/Edge 90+
    const uad = (navigator as any).userAgentData;
    if (!uad) return base;

    const hints = await uad.getHighEntropyValues([
      'platformVersion',
      'model',
    ]);

    // Platform version normalisation
    // Chrome on Windows returns "15.0.0" for Win11, "0.1.0" for Win10
    let os_version = base.os_version;
    if (hints.platformVersion) {
      if (base.os === 'Windows') {
        const major = parseInt(hints.platformVersion.split('.')[0], 10);
        os_version = major >= 13 ? '11' : '10';
      } else {
        os_version = hints.platformVersion || base.os_version;
      }
    }

    return {
      ...base,
      os_version,
      device_model: hints.model || null,
    };
  } catch {
    return base;
  }
}
