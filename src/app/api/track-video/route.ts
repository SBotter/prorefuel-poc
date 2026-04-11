import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { VideoUploadInsert } from "@/lib/supabase/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const record: VideoUploadInsert = {
      processing_session_id:    body.processing_session_id    ?? null,
      filename:                 body.filename                 ?? null,
      file_size_bytes:          body.file_size_bytes          ?? null,
      camera_model:             body.camera_model             ?? null,
      has_gps:                  body.has_gps                  ?? null,
      gps_points_count:         body.gps_points_count         ?? null,
      gps_duration_s:           body.gps_duration_s           ?? null,
      gps_sampling_interval_ms: body.gps_sampling_interval_ms ?? null,
      gps_start_utc:            body.gps_start_utc            ?? null,
      gps_end_utc:              body.gps_end_utc              ?? null,
      gps_video_offset_ms:      body.gps_video_offset_ms      ?? null,
      has_gps_lock:             body.has_gps_lock             ?? null,
      gps_lock_latency_s:       body.gps_lock_latency_s       ?? null,
      pre_lock_points:          body.pre_lock_points          ?? null,
      post_lock_points:         body.post_lock_points         ?? null,
      speed_avg_kmh:            body.speed_avg_kmh            ?? null,
      speed_max_kmh:            body.speed_max_kmh            ?? null,
      distance_m:               body.distance_m               ?? null,
      fix_pct_no_fix:           body.fix_pct_no_fix           ?? null,
      fix_pct_2d:               body.fix_pct_2d               ?? null,
      fix_pct_3d:               body.fix_pct_3d               ?? null,
      app_version:              body.app_version              ?? null,
    };

    const supabase = createServerClient();
    const { error } = await supabase.from("video_uploads").insert(record);

    if (error) {
      console.error("[track-video] Supabase insert error:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[track-video] Unexpected error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
