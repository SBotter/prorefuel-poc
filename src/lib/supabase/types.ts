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
      error_events: {
        Row: ErrorEvent;
        Insert: ErrorEventInsert;
        Update: Partial<ErrorEventInsert>;
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

  // Recording device (camera / phone) — optional for backward compat
  device_type?: "gopro" | "iphone" | "android" | "whatsapp" | "unknown" | null;
  device_make?: string | null;       // 'Apple', 'Samsung', 'GoPro'
  device_model?: string | null;      // 'iPhone 13', 'Galaxy S24 FE', 'HERO12 Black'
  device_os?: string | null;         // 'iOS', 'Android' (null for action cams)
  device_os_version?: string | null; // '17.1', '16' (from video metadata)

  // Browser / web-app client device — optional for backward compat
  browser_os?: string | null;         // 'Windows', 'macOS', 'iOS', 'Android', 'Linux'
  browser_os_version?: string | null; // '11', '14.5'
  browser_name?: string | null;       // 'Chrome', 'Safari', 'Firefox'
  browser_version?: string | null;    // '125.0'
  browser_is_mobile?: boolean | null;

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
  gps_device_brand?: string | null;  // 'Garmin', 'Suunto', 'Wahoo' — parsed from creator
  gps_device_model?: string | null;  // 'Edge 530', 'Fenix 7 Pro' — null when via app
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

  // Mobile action: which button the user tapped after the video was ready
  // Requires column: ALTER TABLE video_exports ADD COLUMN download_action text;
  download_action?: "save" | "share" | null;

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

  // Recording device details — optional for backward compat
  device_type?: "gopro" | "iphone" | "android" | "whatsapp" | "unknown" | null;
  device_make?: string | null;       // 'Apple', 'Samsung', 'GoPro'
  device_model?: string | null;      // 'iPhone 13', 'Galaxy S24 FE', 'HERO12 Black'
  device_os?: string | null;         // 'iOS', 'Android' (null for action cams)
  device_os_version?: string | null; // '17.1', '16'

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

// ── Error Events ──────────────────────────────────────────────────────────────
// SQL migration:
// create table public.error_events (
//   id uuid default gen_random_uuid() primary key,
//   created_at timestamptz default now() not null,
//   error_code text not null,
//   error_message text,
//   error_source text,
//   app_version text,
//   user_agent text
// );

export type ErrorCode =
  | "WRONG_VIDEO_FORMAT"
  | "UNSUPPORTED_CAMERA"
  | "NO_GPS_VIDEO"
  | "GPS_WEAK"
  | "VIDEO_GPX_MISMATCH"
  | "NO_SCENES"
  | "WRONG_GPX_FORMAT"
  | "NO_GPS_TRACK"
  | "RENDER_OOM"
  | "RENDER_FAILED"
  | "WORKER_ERROR"
  | "HEVC_TRANSCODE_OK"  // performance event — successful HEVC→H.264 transcode with timing
  | "UNKNOWN";

export interface ErrorEvent {
  id: string;
  created_at: string;
  error_code: ErrorCode;
  error_message: string | null;
  error_source: string | null;

  // Recording device (the camera that shot the video)
  device_type?: "gopro" | "iphone" | "android" | "whatsapp" | "unknown" | null;
  device_make?: string | null;   // 'GoPro', 'Apple', 'Samsung', …
  device_model?: string | null;  // 'HERO12 Black', 'iPhone 15 Pro', …

  // File submitted by the user
  file_extension?: string | null;   // '.mov', '.mp4', '.gpx'
  file_size_bytes?: number | null;  // raw bytes — NULL for pre-file errors
  file_mime_type?: string | null;   // 'video/mp4', 'video/quicktime', …

  // Video codec + stream metadata (from MP4 container byte scan)
  video_codec?: string | null;      // 'h264' | 'hevc' | 'unknown'
  video_width?: number | null;      // e.g. 3840
  video_height?: number | null;     // e.g. 2160
  video_fps?: number | null;        // e.g. 59.9
  video_has_gps?: boolean | null;   // true when GPMF telemetry stream present
  video_recorded_at?: string | null; // ISO 8601 — from MP4 mvhd creation_time

  // GPX time range (to compute temporal overlap with video)
  gpx_start_at?: string | null;     // ISO 8601 — first GPX timestamp
  gpx_end_at?: string | null;       // ISO 8601 — last GPX timestamp
  gpx_point_count?: number | null;  // total track points

  // Browser / phone used to ACCESS LENS (may differ from recording device)
  browser_os?: string | null;          // 'iOS' | 'Android' | 'Windows' | 'macOS'
  browser_os_version?: string | null;  // '17', '16.4', '13', …
  browser_name?: string | null;        // 'Chrome' | 'Safari' | 'Firefox' | 'Edge'
  browser_version?: string | null;     // major version string

  // Client hardware hints (browser API — approximate / may be null)
  device_memory_gb?: number | null;  // navigator.deviceMemory (Android Chrome only)
  cpu_cores?: number | null;         // navigator.hardwareConcurrency

  // GPX source — raw <gpx creator="..."> attribute (demand signal for unsupported GPS devices)
  gpx_creator?: string | null;       // e.g. 'Wahoo ELEMNT BOLT', 'Apple Watch', 'Coros Apex 2'

  // HEVC transcoding performance (null for non-HEVC or non-transcode events)
  hevc_transcode_ms?: number | null; // wall-clock ms from FFmpeg start to file ready

  app_version: string | null;
  user_agent: string | null;
}

// ── ErrorContext — structured context passed to trackError() ──────────────────
// Build this at upload time and pass to every trackError() call.
// Fields are additive: start with browser context, add cam + codec as detected.
export interface ErrorContext {
  // Recording device
  device_type?: string | null;
  device_make?: string | null;
  device_model?: string | null;
  // File
  file_extension?: string | null;
  file_size_bytes?: number | null;
  file_mime_type?: string | null;
  // Codec + video stream metadata
  video_codec?: string | null;
  video_width?: number | null;
  video_height?: number | null;
  video_fps?: number | null;
  video_has_gps?: boolean | null;
  video_recorded_at?: string | null;
  // GPX time range
  gpx_start_at?: string | null;
  gpx_end_at?: string | null;
  gpx_point_count?: number | null;
  // Browser / phone
  browser_os?: string | null;
  browser_os_version?: string | null;
  browser_name?: string | null;
  browser_version?: string | null;
  // Hardware
  device_memory_gb?: number | null;
  cpu_cores?: number | null;
  // GPX source — raw <gpx creator="..."> attribute
  gpx_creator?: string | null;

  // HEVC transcoding performance
  hevc_transcode_ms?: number | null;
}

export type ErrorEventInsert = Omit<ErrorEvent, "id" | "created_at">;
