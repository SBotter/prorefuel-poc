import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const record: Record<string, unknown> = {
      // Core columns — always present in schema
      error_code:    body.error_code    ?? "UNKNOWN",
      error_message: body.error_message ?? null,
      error_source:  body.error_source  ?? null,
      app_version:   body.app_version   ?? null,
      user_agent:    req.headers.get("user-agent") ?? null,
    };

    // Optional extended columns — only included when non-null
    // Requires: ALTER TABLE error_events ADD COLUMN IF NOT EXISTS <col> ...
    const optional: Record<string, unknown> = {
      device_type:    body.device_type,
      device_make:    body.device_make,
      device_model:   body.device_model,
      file_extension: body.file_extension,
    };
    for (const [k, v] of Object.entries(optional)) {
      if (v != null) record[k] = v;
    }

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
