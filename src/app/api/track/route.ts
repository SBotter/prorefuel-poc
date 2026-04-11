import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { ProcessingSessionInsert } from "@/lib/supabase/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const session: ProcessingSessionInsert = {
      video_filename:     body.video_filename     ?? null,
      video_duration_s:   body.video_duration_s   ?? null,
      camera_model:       body.camera_model       ?? null,
      activity_name:      body.activity_name      ?? null,
      gpx_points_count:   body.gpx_points_count   ?? null,
      gps_device:         body.gps_device         ?? null,
      activity_location:  body.activity_location  ?? null,
      sync_strategy:      body.sync_strategy      ?? null,
      scenes_count:       body.scenes_count       ?? null,
      unit_system:        body.unit_system        ?? null,
      processing_time_ms: body.processing_time_ms ?? null,
      status:             body.status === "error" ? "error" : "success",
      error_message:      body.error_message      ?? null,
      user_agent:         req.headers.get("user-agent") ?? null,
      app_version:        body.app_version        ?? null,
    };

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("processing_sessions")
      .insert(session)
      .select("id")
      .single();

    if (error) {
      console.error("[track] Supabase insert error:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err: any) {
    console.error("[track] Unexpected error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
