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

    // Optional extended columns — only included when non-null.
    // Requires migration: migrations/2026-05-25_enrich-error-events.sql
    const optional: Record<string, unknown> = {
      // Recording device (camera)
      device_type:    body.device_type,
      device_make:    body.device_make,
      device_model:   body.device_model,
      // File
      file_extension:  body.file_extension,
      file_size_bytes: body.file_size_bytes,
      file_mime_type:  body.file_mime_type,
      // Codec + stream metadata
      video_codec:       body.video_codec,
      video_width:       body.video_width,
      video_height:      body.video_height,
      video_fps:         body.video_fps,
      video_has_gps:     body.video_has_gps,
      video_recorded_at: body.video_recorded_at,
      // GPX time range
      gpx_start_at:      body.gpx_start_at,
      gpx_end_at:        body.gpx_end_at,
      gpx_point_count:   body.gpx_point_count,
      // Browser / phone
      browser_os:         body.browser_os,
      browser_os_version: body.browser_os_version,
      browser_name:       body.browser_name,
      browser_version:    body.browser_version,
      // Hardware
      device_memory_gb: body.device_memory_gb,
      cpu_cores:        body.cpu_cores,
      // GPX source (demand signal for unsupported GPS devices)
      gpx_creator: body.gpx_creator,
      // HEVC transcode performance (HEVC_TRANSCODE_OK events + failed transcode errors)
      hevc_transcode_ms: body.hevc_transcode_ms,
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
