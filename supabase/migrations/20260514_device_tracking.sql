-- ── Device Tracking Migration ──────────────────────────────────────────────
-- Adds recording device (camera/phone) + browser client device fields.
-- All columns are nullable — existing rows get NULL, no backfill needed.

-- ── processing_sessions ───────────────────────────────────────────────────────
-- Recording device (from video metadata)
ALTER TABLE public.processing_sessions
  ADD COLUMN IF NOT EXISTS device_type        text,         -- 'gopro' | 'iphone' | 'android' | 'unknown'
  ADD COLUMN IF NOT EXISTS device_make        text,         -- 'Apple', 'Samsung', 'GoPro'
  ADD COLUMN IF NOT EXISTS device_model       text,         -- 'iPhone 13', 'Galaxy S24 FE', 'HERO12 Black'
  ADD COLUMN IF NOT EXISTS device_os          text,         -- 'iOS', 'Android' (null for action cams)
  ADD COLUMN IF NOT EXISTS device_os_version  text,         -- '17.1', '16'
  -- Browser / web-app client (from User-Agent / userAgentData)
  ADD COLUMN IF NOT EXISTS browser_os         text,         -- 'Windows', 'macOS', 'iOS', 'Android', 'Linux'
  ADD COLUMN IF NOT EXISTS browser_os_version text,         -- '11', '14.5'
  ADD COLUMN IF NOT EXISTS browser_name       text,         -- 'Chrome', 'Safari', 'Firefox'
  ADD COLUMN IF NOT EXISTS browser_version    text,         -- '125.0'
  ADD COLUMN IF NOT EXISTS browser_is_mobile  boolean;      -- true if mobile browser

-- ── video_uploads ─────────────────────────────────────────────────────────────
ALTER TABLE public.video_uploads
  ADD COLUMN IF NOT EXISTS device_type        text,
  ADD COLUMN IF NOT EXISTS device_make        text,
  ADD COLUMN IF NOT EXISTS device_model       text,
  ADD COLUMN IF NOT EXISTS device_os          text,
  ADD COLUMN IF NOT EXISTS device_os_version  text;

-- ── error_events ──────────────────────────────────────────────────────────────
ALTER TABLE public.error_events
  ADD COLUMN IF NOT EXISTS device_type   text,
  ADD COLUMN IF NOT EXISTS device_make   text,
  ADD COLUMN IF NOT EXISTS device_model  text,
  ADD COLUMN IF NOT EXISTS file_extension text;  -- '.mov', '.mp4', '.gpx'

-- ── Indexes for dashboard queries ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_proc_device_type   ON public.processing_sessions (device_type);
CREATE INDEX IF NOT EXISTS idx_proc_device_make   ON public.processing_sessions (device_make);
CREATE INDEX IF NOT EXISTS idx_proc_browser_os    ON public.processing_sessions (browser_os);
CREATE INDEX IF NOT EXISTS idx_video_device_type  ON public.video_uploads (device_type);
CREATE INDEX IF NOT EXISTS idx_err_device_type    ON public.error_events (device_type);
CREATE INDEX IF NOT EXISTS idx_err_file_extension ON public.error_events (file_extension);
