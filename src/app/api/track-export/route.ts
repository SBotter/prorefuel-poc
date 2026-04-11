import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { VideoExportInsert } from "@/lib/supabase/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const record: VideoExportInsert = {
      processing_session_id: body.processing_session_id ?? null,
      reached_experience:    body.reached_experience    ?? false,
      clicked_record:        body.clicked_record        ?? false,
      completed_download:    body.completed_download     ?? false,
      time_on_ready_ms:      body.time_on_ready_ms      ?? null,
      time_to_download_ms:   body.time_to_download_ms   ?? null,
      render_duration_ms:    body.render_duration_ms    ?? null,
      render_status:         body.render_status         ?? null,
      error_message:         body.error_message         ?? null,
      output_format:         body.output_format         ?? null,
      output_size_bytes:     body.output_size_bytes     ?? null,
      output_duration_s:     body.output_duration_s     ?? null,
      app_version:           body.app_version           ?? null,
    };

    const supabase = createServerClient();
    const { error } = await supabase.from("video_exports").insert(record);

    if (error) {
      console.error("[track-export] Supabase insert error:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[track-export] Unexpected error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
