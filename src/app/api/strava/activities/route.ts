import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decryptToken, encryptToken,
  STRAVA_COOKIE, COOKIE_MAX_AGE,
} from "@/lib/strava/token";
import { fetchActivities } from "@/lib/strava/api";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const raw = cookieStore.get(STRAVA_COOKIE)?.value;

  if (!raw) {
    return NextResponse.json({ error: "Not connected to Strava" }, { status: 401 });
  }

  let token;
  try {
    token = decryptToken(raw);
  } catch {
    return NextResponse.json({ error: "Invalid Strava session" }, { status: 401 });
  }

  // Silent refresh if token expired
  const now = Math.floor(Date.now() / 1000);
  let refreshedCookie: string | null = null;
  if (token.expires_at <= now) {
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
        return NextResponse.json({ error: "Strava session expired. Please reconnect." }, { status: 401 });
      }
      const data = await res.json();
      token = { ...token, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at };
      refreshedCookie = encryptToken(token);
    } catch {
      return NextResponse.json({ error: "Strava session expired. Please reconnect." }, { status: 401 });
    }
  }

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10));

  try {
    const activities = await fetchActivities(token.access_token, page);
    const response = NextResponse.json(activities);
    if (refreshedCookie) {
      response.cookies.set(STRAVA_COOKIE, refreshedCookie, {
        httpOnly: true, secure: true, sameSite: "lax", maxAge: COOKIE_MAX_AGE, path: "/",
      });
    }
    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to fetch activities" }, { status: 502 });
  }
}
