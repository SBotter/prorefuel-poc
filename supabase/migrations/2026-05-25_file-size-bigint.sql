-- file_size_bytes was INTEGER (max ~2.1 GB) — overflows silently for files >= 2 GB.
-- Widen to BIGINT. Must drop all dependent views first, then recreate them.

DROP VIEW IF EXISTS v_error_summary;
DROP VIEW IF EXISTS v_codec_error_rate;
DROP VIEW IF EXISTS v_success_rate_by_camera;

ALTER TABLE video_uploads       ALTER COLUMN file_size_bytes TYPE bigint;
ALTER TABLE error_events        ALTER COLUMN file_size_bytes TYPE bigint;

-- Recreate views

CREATE OR REPLACE VIEW v_error_summary AS
SELECT
    error_code,
    error_source,
    device_type,
    device_make,
    device_model,
    browser_os,
    browser_os_version,
    browser_name,
    video_codec,
    CASE
        WHEN file_size_bytes IS NULL              THEN 'Unknown'
        WHEN file_size_bytes <  100 * 1048576    THEN '< 100 MB'
        WHEN file_size_bytes <  300 * 1048576    THEN '100–300 MB'
        WHEN file_size_bytes < 1024 * 1048576    THEN '300 MB–1 GB'
        WHEN file_size_bytes < 1536 * 1048576    THEN '1–1.5 GB'
        ELSE '> 1.5 GB'
    END AS file_size_bucket,
    device_memory_gb,
    cpu_cores,
    COUNT(*)                                     AS error_count,
    DATE_TRUNC('day', created_at)                AS day
FROM error_events
GROUP BY
    error_code, error_source, device_type, device_make, device_model,
    browser_os, browser_os_version, browser_name, video_codec,
    file_size_bucket, device_memory_gb, cpu_cores,
    DATE_TRUNC('day', created_at)
ORDER BY day DESC, error_count DESC;

COMMENT ON VIEW v_error_summary IS
    'Aggregated error diagnostics. Use for ad-hoc analysis in SQL editor or BI.';

CREATE OR REPLACE VIEW v_success_rate_by_camera AS
SELECT
    CASE device_type
        WHEN 'gopro'   THEN 'GoPro'
        WHEN 'iphone'  THEN 'iPhone'
        WHEN 'android' THEN 'Android'
        ELSE 'Unknown'
    END                                          AS camera_type,
    COUNT(*)                                     AS total_sessions,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
    SUM(CASE WHEN status = 'error'   THEN 1 ELSE 0 END) AS error_count,
    ROUND(
        100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) / COUNT(*),
        1
    )                                            AS success_pct
FROM processing_sessions
WHERE device_type IS NOT NULL
GROUP BY device_type
ORDER BY total_sessions DESC;

COMMENT ON VIEW v_success_rate_by_camera IS
    'Success vs error rate grouped by camera/recording device type.';

CREATE OR REPLACE VIEW v_codec_error_rate AS
SELECT
    video_codec,
    browser_os,
    browser_name,
    COUNT(*)                                     AS error_count,
    MIN(file_size_bytes) / 1048576.0             AS min_size_mb,
    MAX(file_size_bytes) / 1048576.0             AS max_size_mb,
    AVG(file_size_bytes) / 1048576.0             AS avg_size_mb
FROM error_events
WHERE video_codec IS NOT NULL
GROUP BY video_codec, browser_os, browser_name
ORDER BY error_count DESC;

COMMENT ON VIEW v_codec_error_rate IS
    'Error counts grouped by video codec, OS, and browser. Diagnose HEVC issues.';
