import { NextRequest, NextResponse } from "next/server";
import {
  decrypt, encryptToken,
  STRAVA_COOKIE, COOKIE_MAX_AGE,
} from "@/lib/strava/token";

// GET /api/auth/strava/callback?code=...&state=...
// Called by Strava after the user authorizes the app.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const appBase = "https://lens.prorefuel.app";

  // User denied access on Strava
  if (error || !code || !state) {
    return NextResponse.redirect(`${appBase}/?strava=denied`);
  }

  // Validate and decode state
  let origin = "desktop";
  try {
    const decoded = JSON.parse(decrypt(state));
    if (decoded.origin === "mobile") origin = "mobile";
  } catch {
    return NextResponse.redirect(`${appBase}/?strava=error`);
  }

  const redirectTo = origin === "mobile"
    ? `${appBase}/mobile?strava=connected`
    : `${appBase}/?strava=connected`;

  // Exchange code for access token
  try {
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type:    "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("[strava/callback] token exchange failed:", tokenRes.status);
      return NextResponse.redirect(`${appBase}/?strava=error`);
    }

    const data = await tokenRes.json();

    const encrypted = encryptToken({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    data.expires_at,
      athlete_id:    data.athlete?.id ?? 0,
    });

    const response = NextResponse.redirect(redirectTo);
    response.cookies.set(STRAVA_COOKIE, encrypted, {
      httpOnly: true,
      secure:   true,
      sameSite: "lax",
      maxAge:   COOKIE_MAX_AGE,
      path:     "/",
    });

    return response;
  } catch (err) {
    console.error("[strava/callback] unexpected error:", err);
    return NextResponse.redirect(`${appBase}/?strava=error`);
  }
}
