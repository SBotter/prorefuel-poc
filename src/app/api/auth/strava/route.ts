import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { encrypt } from "@/lib/strava/token";

// GET /api/auth/strava?origin=desktop|mobile
// Desktop → direct redirect to Strava web OAuth.
// Mobile  → intermediate page that tries the Strava app first,
//           falls back to the Strava website after 1.5s if the app
//           is not installed (standard app-to-app OAuth pattern).
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.searchParams.get("origin") ?? "desktop";

  const clientId    = process.env.STRAVA_CLIENT_ID;
  const redirectUri = process.env.STRAVA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Strava not configured" }, { status: 500 });
  }

  const nonce = randomBytes(16).toString("hex");
  const state = encrypt(JSON.stringify({ origin, nonce }));

  const params = new URLSearchParams({
    client_id:       clientId,
    redirect_uri:    redirectUri,
    response_type:   "code",
    approval_prompt: "auto",
    scope:           "activity:read",
    state,
  });

  const webUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;

  // ── Desktop: direct redirect ──────────────────────────────────────────────
  const ua       = req.headers.get("user-agent") ?? "";
  const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);

  if (!isMobile) {
    return NextResponse.redirect(webUrl);
  }

  // ── Mobile: try Strava app first, fall back to web ────────────────────────
  // The strava:// scheme opens the Strava app directly if installed.
  // On iOS and Android, authorized users only see a one-tap confirm screen
  // instead of a full login page — much smoother UX.
  // If the app is not installed the timeout redirect opens the website.
  const appUrl = `strava://oauth/mobile/authorize?${params.toString()}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Connecting to Strava…</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#050505;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100dvh;gap:20px;padding:24px;text-align:center}
    .logo{width:56px;height:56px;background:#FC4C02;border-radius:14px;
          display:flex;align-items:center;justify-content:center}
    .logo svg{width:32px;height:32px;fill:white}
    h2{font-size:18px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}
    p{color:#71717a;font-size:13px;line-height:1.5;max-width:260px}
    .fallback{margin-top:8px;font-size:12px;color:#52525b}
    .fallback a{color:#FC4C02;text-decoration:none;font-weight:700}
    .spinner{width:24px;height:24px;border:3px solid #FC4C02;border-top-color:transparent;
             border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="logo">
    <svg viewBox="0 0 24 24"><path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>
  </div>
  <h2>Connecting to Strava</h2>
  <div class="spinner"></div>
  <p>Opening the Strava app…</p>
  <p class="fallback">App not opening? <a href="${webUrl}">Open in browser instead</a></p>
  <script>
    // Try to open the Strava app via URL scheme
    window.location.href = '${appUrl}';
    // If the app is not installed the navigation above fails silently;
    // after 1.5s we fall through to the Strava website.
    var t = setTimeout(function(){
      window.location.href = '${webUrl}';
    }, 1500);
    // If the page becomes hidden (app opened), cancel the timeout
    document.addEventListener('visibilitychange', function(){
      if (document.hidden) clearTimeout(t);
    });
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
