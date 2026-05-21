import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error("ENCRYPTION_SECRET is not set");
  // Pad or truncate to exactly 32 bytes
  return Buffer.alloc(32, secret, "utf8");
}

export function encrypt(text: string): string {
  const key = getKey();
  const iv  = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

export function decrypt(data: string): string {
  const [ivHex, tagHex, encHex] = data.split(".");
  if (!ivHex || !tagHex || !encHex) throw new Error("Invalid encrypted data");
  const key = getKey();
  const iv        = Buffer.from(ivHex, "hex");
  const tag       = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const decipher  = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

export interface StravaToken {
  access_token:  string;
  refresh_token: string;
  expires_at:    number; // Unix timestamp (seconds)
  athlete_id:    number;
}

export const STRAVA_COOKIE = "lens_strava";
export const COOKIE_MAX_AGE = 60 * 60 * 6; // 6 hours

export function encryptToken(token: StravaToken): string {
  return encrypt(JSON.stringify(token));
}

export function decryptToken(cookieValue: string): StravaToken {
  return JSON.parse(decrypt(cookieValue)) as StravaToken;
}
