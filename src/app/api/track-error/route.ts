import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { ErrorEventInsert } from "@/lib/supabase/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const record: ErrorEventInsert = {
      error_code:    body.error_code    ?? "UNKNOWN",
      error_message: body.error_message ?? null,
      error_source:  body.error_source  ?? null,
      app_version:   body.app_version   ?? null,
      user_agent:    req.headers.get("user-agent") ?? null,
    };

    const supabase = createServerClient();
    const { error } = await supabase.from("error_events").insert(record);

    if (error) {
      console.warn("[track-error] Supabase insert error:", error.message);
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.warn("[track-error] Unexpected error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
