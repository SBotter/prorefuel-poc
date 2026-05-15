import { NextRequest, NextResponse } from "next/server";

const MOBILE_UA = /iPhone|iPad|iPod|Android|Mobile|BlackBerry|IEMobile|Opera Mini/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Mobile redirect: / → /mobile ────────────────────────────────────────
  // Serves a lighter, mobile-optimised page instead of the heavy desktop app.
  // /mobile handles its own capability gate (iOS 16.4+ gets the form,
  // older devices get the "Update Required" screen).
  if (pathname === "/") {
    const ua = req.headers.get("user-agent") ?? "";
    if (MOBILE_UA.test(ua)) {
      return NextResponse.redirect(new URL("/mobile", req.url));
    }
  }

  // ── Dashboard auth guard ─────────────────────────────────────────────────
  if (pathname.startsWith("/dashboard")) {
    const isLoginPage = pathname === "/dashboard/login";
    if (!isLoginPage) {
      const auth = req.cookies.get("lens_dash_auth");
      if (!auth?.value) {
        return NextResponse.redirect(new URL("/dashboard/login", req.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
