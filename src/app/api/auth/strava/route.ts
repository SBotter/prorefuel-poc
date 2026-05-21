import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { encrypt } from "@/lib/strava/token";

// GET /api/auth/strava?origin=desktop|mobile
// Redirects the user to Strava's OAuth authorization page.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.searchParams.get("origin") ?? "desktop";

  const clientId    = process.env.STRAVA_CLIENT_ID;
  const redirectUri = process.env.STRAVA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Strava not configured" }, { status: 500 });
  }

  // Encode origin + nonce in state to:
  //   1. Know where to redirect back after callback (desktop vs mobile)
  //   2. Prevent CSRF attacks
  const nonce = randomBytes(16).toString("hex");
  const state = encrypt(JSON.stringify({ origin, nonce }));

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope:         "activity:read",
    state,
  });

  return NextResponse.redirect(
    `https://www.strava.com/oauth/authorize?${params.toString()}`,
  );
}
