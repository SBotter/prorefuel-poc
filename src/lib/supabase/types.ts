/**
 * Auto-generated types for the Supabase database schema.
 * Re-generate with: npx supabase gen types typescript --linked > src/lib/supabase/types.ts
 */

export type Database = {
  public: {
    Tables: {
      processing_sessions: {
        Row: ProcessingSession;
        Insert: ProcessingSessionInsert;
        Update: Partial<ProcessingSessionInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export interface ProcessingSession {
  id: string;
  created_at: string;

  // Video metadata
  video_filename: string | null;
  video_duration_s: number | null;
  camera_model: string | null;

  // Activity metadata
  activity_name: string | null;
  gpx_points_count: number | null;
  gps_device: string | null;
  activity_location: string | null;

  // Sync
  sync_strategy: string | null;

  // Output
  scenes_count: number | null;
  unit_system: string | null;

  // Performance
  processing_time_ms: number | null;

  // Result
  status: "success" | "error";
  error_message: string | null;

  // Context
  user_agent: string | null;
  app_version: string | null;
}

export type ProcessingSessionInsert = Omit<ProcessingSession, "id" | "created_at">;

// ── GPX Sessions ─────────────────────────────────────────────────────────────

export interface GpxSession {
  id: string;
  created_at: string;

  // Identity
  creator: string | null;
  activity_type: string | null;
  activity_name: string | null;
  activity_start_at: string | null;
  activity_location: string | null;

  // File structure quality
  total_points: number | null;
  avg_sample_interval_s: number | null;
  has_all_timestamps: boolean | null;
  gap_count: number | null;
  invalid_point_count: number | null;

  // Route metrics
  duration_s: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  altitude_max_m: number | null;
  altitude_min_m: number | null;

  // Performance data presence
  has_hr: boolean | null;
  has_cadence: boolean | null;
  has_power: boolean | null;
  has_speed: boolean | null;

  // Performance data values
  hr_avg: number | null;
  hr_max: number | null;
  power_avg: number | null;
  power_max: number | null;

  // FK → processing_sessions (parent record)
  processing_session_id: string | null;

  // App context
  app_version: string | null;
}

export type GpxSessionInsert = Omit<GpxSession, "id" | "created_at">;

// ── Video Exports ─────────────────────────────────────────────────────────────

export interface VideoExport {
  id: string;
  created_at: string;

  processing_session_id: string | null;

  // Funnel
  reached_experience: boolean;
  clicked_record: boolean;
  completed_download: boolean;

  // User timing
  time_on_ready_ms: number | null;
  time_to_download_ms: number | null;

  // Engine performance
  render_duration_ms: number | null;
  render_status: "success" | "error" | "fallback" | null;
  error_message: string | null;

  // Output details
  output_format: string | null;
  output_size_bytes: number | null;
  output_duration_s: number | null;

  app_version: string | null;
}

export type VideoExportInsert = Omit<VideoExport, "id" | "created_at">;

// ── Video Uploads ─────────────────────────────────────────────────────────────

export interface VideoUpload {
  id: string;
  created_at: string;

  processing_session_id: string | null;

  // File identity
  filename: string | null;
  file_size_bytes: number | null;
  camera_model: string | null;

  // GPS presence
  has_gps: boolean | null;
  gps_points_count: number | null;
  gps_duration_s: number | null;
  gps_sampling_interval_ms: number | null;
  gps_start_utc: string | null;
  gps_end_utc: string | null;
  gps_video_offset_ms: number | null;

  // GPS lock quality
  has_gps_lock: boolean | null;
  gps_lock_latency_s: number | null;
  pre_lock_points: number | null;
  post_lock_points: number | null;

  // Telemetry values
  speed_avg_kmh: number | null;
  speed_max_kmh: number | null;
  distance_m: number | null;

  // Fix quality distribution
  fix_pct_no_fix: number | null;
  fix_pct_2d: number | null;
  fix_pct_3d: number | null;

  app_version: string | null;
}

export type VideoUploadInsert = Omit<VideoUpload, "id" | "created_at">;
