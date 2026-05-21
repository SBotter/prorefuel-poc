import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decryptToken, STRAVA_COOKIE } from "@/lib/strava/token";
import { fetchActivities } from "@/lib/strava/api";

export async function GET(_req: NextRequest) {
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

  // Check if token expired
  if (token.expires_at < Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: "Strava session expired. Please reconnect." }, { status: 401 });
  }

  try {
    const activities = await fetchActivities(token.access_token);
    return NextResponse.json(activities);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to fetch activities" }, { status: 502 });
  }
}
