import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decryptToken, STRAVA_COOKIE } from "@/lib/strava/token";
import { buildGpxForActivity } from "@/lib/strava/api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const activityId = parseInt(id, 10);

  if (!activityId || isNaN(activityId)) {
    return NextResponse.json({ error: "Invalid activity ID" }, { status: 400 });
  }

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

  if (token.expires_at < Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: "Strava session expired. Please reconnect." }, { status: 401 });
  }

  try {
    const gpx = await buildGpxForActivity(activityId, token.access_token);
    return NextResponse.json({ gpx });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to build GPX" },
      { status: err.message?.includes("no GPS") ? 422 : 502 },
    );
  }
}
