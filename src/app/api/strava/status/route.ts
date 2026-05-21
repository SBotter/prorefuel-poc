import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decryptToken, encryptToken,
  STRAVA_COOKIE, COOKIE_MAX_AGE,
} from "@/lib/strava/token";

// GET /api/strava/status
// Returns { connected: boolean }.
// If the stored token is expired, attempts a silent refresh using the
// refresh_token so the user never has to re-authorize within the same session.
// On a successful refresh the cookie is updated transparently.
export async function GET(_req: NextRequest) {
  const cookieStore = await cookies();
  const raw = cookieStore.get(STRAVA_COOKIE)?.value;

  if (!raw) {
    return NextResponse.json({ connected: false });
  }

  let token;
  try {
    token = decryptToken(raw);
  } catch {
    return NextResponse.json({ connected: false });
  }

  const now = Math.floor(Date.now() / 1000);

  // Token still valid — connected
  if (token.expires_at > now) {
    return NextResponse.json({ connected: true });
  }

  // Token expired — try silent refresh
  try {
    const res = await fetch("https://www.strava.com/oauth/token", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        grant_type:    "refresh_token",
        refresh_token: token.refresh_token,
      }),
    });

    if (!res.ok) {
      // Refresh failed (revoked, etc.) — need full re-auth
      const response = NextResponse.json({ connected: false });
      response.cookies.delete(STRAVA_COOKIE);
      return response;
    }

    const data = await res.json();
    const refreshed = encryptToken({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    data.expires_at,
      athlete_id:    token.athlete_id,
    });

    const response = NextResponse.json({ connected: true });
    response.cookies.set(STRAVA_COOKIE, refreshed, {
      httpOnly: true,
      secure:   true,
      sameSite: "lax",
      maxAge:   COOKIE_MAX_AGE,
      path:     "/",
    });
    return response;
  } catch {
    return NextResponse.json({ connected: false });
  }
}
