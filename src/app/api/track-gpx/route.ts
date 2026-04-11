import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { GpxSessionInsert } from "@/lib/supabase/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const session: GpxSessionInsert = {
      creator:               body.creator               ?? null,
      activity_type:         body.activity_type         ?? null,
      activity_name:         body.activity_name         ?? null,
      activity_start_at:     body.activity_start_at     ?? null,
      activity_location:     body.activity_location     ?? null,
      total_points:          body.total_points          ?? null,
      avg_sample_interval_s: body.avg_sample_interval_s ?? null,
      has_all_timestamps:    body.has_all_timestamps    ?? null,
      gap_count:             body.gap_count             ?? null,
      invalid_point_count:   body.invalid_point_count   ?? null,
      duration_s:            body.duration_s            ?? null,
      distance_m:            body.distance_m            ?? null,
      elevation_gain_m:      body.elevation_gain_m      ?? null,
      elevation_loss_m:      body.elevation_loss_m      ?? null,
      altitude_max_m:        body.altitude_max_m        ?? null,
      altitude_min_m:        body.altitude_min_m        ?? null,
      has_hr:                body.has_hr                ?? null,
      has_cadence:           body.has_cadence           ?? null,
      has_power:             body.has_power             ?? null,
      has_speed:             body.has_speed             ?? null,
      hr_avg:                body.hr_avg                ?? null,
      hr_max:                body.hr_max                ?? null,
      power_avg:             body.power_avg             ?? null,
      power_max:             body.power_max             ?? null,
      processing_session_id: body.processing_session_id ?? null,
      app_version:           body.app_version           ?? null,
    };

    const supabase = createServerClient();
    const { error } = await supabase.from("gpx_sessions").insert(session);

    if (error) {
      console.error("[track-gpx] Supabase insert error:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[track-gpx] Unexpected error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
