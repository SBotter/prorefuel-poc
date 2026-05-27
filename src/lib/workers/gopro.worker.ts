import gpmfExtract from 'gpmf-extract';
import goproTelemetry from 'gopro-telemetry';

self.onmessage = async (e: MessageEvent) => {
  try {
    const file = e.data.file;

    const extracted = await gpmfExtract(file, { browserMode: true });

    if (!extracted || !extracted.rawData) {
      throw new Error("GPMF track is empty or corrupted.");
    }

    const telemetry = await goproTelemetry(extracted, { stream: ['GPS5', 'ACCL', 'GYRO'] });

    const deviceIds = Object.keys(telemetry);
    if (deviceIds.length === 0) throw new Error("No telemetry sensors returned.");

    const deviceEntry = (telemetry as any)[deviceIds[0]];
    const cameraModel: string = deviceEntry?.deviceName || "";
    const streams = deviceEntry?.streams;
    if (!streams || !streams.GPS5 || !streams.GPS5.samples) {
      throw new Error("No GPS coordinate track found (GPS5 missing).");
    }

    const rawSamples: any[] = streams.GPS5.samples;

    // ── CTS → UTC offset ─────────────────────────────────────────────────────
    // Build a fallback epoch offset from the first sample that has both a valid
    // UTC date and a CTS value. Used for samples where gopro-telemetry could not
    // assign a UTC timestamp (e.g. GPS had a position fix but UTC time was absent).
    const refSample = rawSamples.find(
      (s: any) => s.date && typeof s.cts === 'number' && s.cts >= 0,
    );
    const ctsEpochOffset = refSample
      ? new Date(refSample.date).getTime() - (refSample.cts as number)
      : 0;

    // ── Valid sample filter ───────────────────────────────────────────────────
    // IMPORTANT: `sample.date` is intentionally NOT required here.
    // gopro-telemetry omits date when the GPS module had a position fix but the
    // embedded UTC timestamp was unavailable (common in dense forests, tunnels,
    // and when recording starts before GPS fully initialises). Those samples have
    // valid lat/lon and should not be silently discarded.
    // Null-island (0,0) pre-lock samples are already removed by the lat/lon check.
    // CTS-based time interpolation below recovers timestamps for dateless samples.
    const validSamples = rawSamples.filter((sample: any) => {
      if (!sample || !Array.isArray(sample.value) || sample.value.length < 3) return false;
      const lat    = Number(sample.value[0]);
      const lon    = Number(sample.value[1]);
      const spdKmh = Number(sample.value[3]) * 3.6; // GPS5[3] = 2D speed in m/s
      return (
        isFinite(lat) && isFinite(lon)
        && Math.abs(lat) > 0.0001 && Math.abs(lon) > 0.0001 // null-island / cold-start zeros
        && (isNaN(spdKmh) || spdKmh <= 300)                  // GPS speed spikes (real spikes > 500 km/h)
      );
    });

    // ── GPS startup offset ────────────────────────────────────────────────────
    let gpsVideoOffsetMs = 0;
    const chunks = extracted.timing?.samples ?? [];
    let currentFix = (rawSamples[0]?.sticky?.fix ?? 0);
    let firstLockedIdx = currentFix >= 2 ? 0 : -1;
    if (firstLockedIdx === -1) {
      for (let i = 1; i < rawSamples.length; i++) {
        if (rawSamples[i]?.sticky?.fix !== undefined) currentFix = rawSamples[i].sticky.fix;
        if (currentFix >= 2) { firstLockedIdx = i; break; }
      }
    }
    if (firstLockedIdx > 0) {
      const sampleCts = rawSamples[firstLockedIdx]?.cts;
      if (typeof sampleCts === 'number') {
        gpsVideoOffsetMs = sampleCts;
        console.log(`[Worker] GPS lock at sample ${firstLockedIdx} → per-sample CTS=${gpsVideoOffsetMs}ms`);
      } else if (chunks.length > 0) {
        const samplesPerChunk = rawSamples.length / chunks.length;
        const chunkIdx = Math.min(Math.floor(firstLockedIdx / samplesPerChunk), chunks.length - 1);
        const sampleWithinChunk = firstLockedIdx - chunkIdx * Math.round(samplesPerChunk);
        const chunkDurationMs = chunkIdx < chunks.length - 1
          ? (chunks[chunkIdx + 1].cts - chunks[chunkIdx].cts)
          : (chunks[chunkIdx].duration ?? 1000);
        gpsVideoOffsetMs = (chunks[chunkIdx]?.cts ?? 0) +
          (sampleWithinChunk / Math.max(1, Math.round(samplesPerChunk))) * chunkDurationMs;
        console.log(`[Worker] GPS lock at sample ${firstLockedIdx} → chunk-interpolated CTS=${gpsVideoOffsetMs.toFixed(0)}ms`);
      }
    } else if (firstLockedIdx === 0) {
      gpsVideoOffsetMs = rawSamples[0]?.cts ?? chunks[0]?.cts ?? 0;
      console.log(`[Worker] GPS locked from start → offset ${gpsVideoOffsetMs}ms`);
    } else {
      console.log(`[Worker] GPS never locked (fix=0 throughout) — clock offset deferred to position cross-ref`);
    }

    if (validSamples.length === 0) {
      // rawSamples exist (GPS track in file) but all were at 0,0 — GPS enabled
      // but never acquired a position fix during this recording.
      if (rawSamples.length > 0) {
        throw new Error(
          "GPS was enabled but never acquired a position fix during this recording. " +
          "Make sure the sky is visible when you start recording and wait for the GPS lock icon on the camera before pressing Record.",
        );
      }
      throw new Error("No valid GPS points found. This video has no embedded GPS telemetry.");
    }

    const accelSamples: any[] = streams.ACCL?.samples ?? [];
    const gyroSamples:  any[] = streams.GYRO?.samples  ?? [];
    const accelLen = accelSamples.length;
    const gyroLen  = gyroSamples.length;

    const points = validSamples.map((sample: any) => {
      const ratio = rawSamples.length > 1 ? rawSamples.indexOf(sample) / (rawSamples.length - 1) : 0;
      const aIdx  = Math.min(Math.round(ratio * (accelLen - 1)), accelLen - 1);
      const gIdx  = Math.min(Math.round(ratio * (gyroLen  - 1)), gyroLen  - 1);
      const av    = accelSamples[aIdx]?.value;
      const gv    = gyroSamples[gIdx]?.value;
      const accel = av ? Math.sqrt(av[0]**2 + av[1]**2 + av[2]**2) : undefined;
      const gyro  = gv ? Math.abs(gv[2]) : undefined;

      // Timestamp: prefer GPS UTC from gopro-telemetry. Fall back to CTS + epoch
      // offset derived from a reference sample with a known UTC date. This recovers
      // valid GPS positions in recordings where the UTC timestamp was missing but
      // the position fix was valid (e.g. GPS fix without satellite time sync).
      let time: number;
      if (sample.date) {
        time = new Date(sample.date).getTime();
      } else if (ctsEpochOffset > 0 && typeof sample.cts === 'number') {
        time = sample.cts + ctsEpochOffset;
      } else {
        time = 0; // no timestamp recoverable — filtered below
      }

      return {
        lat:   Number(sample.value[0]),
        lon:   Number(sample.value[1]),
        ele:   Number(sample.value[2]),
        time,
        speed: Number(sample.value[3]) * 3.6,
        accel,
        gyro,
      };
    }).filter(p => p.time > 0); // drop points with no recoverable timestamp

    if (points.length === 0) {
      throw new Error(
        "GPS positions found but timestamps could not be recovered. " +
        "Try re-importing the original file directly from the GoPro SD card.",
      );
    }

    // 1 Hz downsample for map rendering and scene detection
    const downsampled: any[] = [];
    let lastTime = 0;
    for (const pt of points) {
      if (pt.time - lastTime >= 1000) {
        downsampled.push(pt);
        lastTime = pt.time;
      }
    }

    // ~4.5 Hz syncPoints — post-lock only, first 2 jitter-dropped
    const SYNC_INTERVAL_MS = 220;
    const rawSyncPoints: any[] = [];
    let lastSyncTime = -Infinity;
    for (const pt of points) {
      if (pt.time - lastSyncTime >= SYNC_INTERVAL_MS) {
        rawSyncPoints.push(pt);
        lastSyncTime = pt.time;
      }
    }
    const lockTimeMs = points.length > 0 ? points[0].time + gpsVideoOffsetMs : 0;
    let syncPoints = lockTimeMs > 0
      ? rawSyncPoints.filter(pt => pt.time >= lockTimeMs)
      : rawSyncPoints;
    if (syncPoints.length > 4) syncPoints = syncPoints.slice(2);

    console.log('[Worker] GPS pipeline summary:', {
      rawSamples:       rawSamples.length,
      validSamples:     validSamples.length,
      pointsWithTime:   points.length,
      downsampled1Hz:   downsampled.length,
      syncPoints4Hz:    syncPoints.length,
      gpsVideoOffsetMs: Math.round(gpsVideoOffsetMs),
      ctsEpochOffset:   ctsEpochOffset > 0 ? `${Math.round(ctsEpochOffset)}ms` : 'none',
      firstValidTime:   downsampled.length > 0 ? new Date(downsampled[0].time).toISOString() : 'n/a',
    });

    self.postMessage({ success: true, points: downsampled, syncPoints, cameraModel, gpsVideoOffsetMs });

  } catch (error: any) {
    const msg = (error?.message || error?.name || String(error) || "").toLowerCase();
    console.error("[GoPro Worker] error:", error);

    let userMsg: string;
    if (msg.includes("track not found") || msg.includes("no tracks") || msg.includes("gpmf")) {
      userMsg = "No GPS telemetry found in this file. Make sure you are using the original GoPro MP4 — do not re-encode or edit the file before importing.";
    } else if (msg.includes("gpmf track is empty") || msg.includes("corrupted")) {
      userMsg = "GPS telemetry track is empty or corrupted. Try a different recording.";
    } else if (msg.includes("never acquired") || msg.includes("position fix")) {
      userMsg = error.message; // already user-friendly
    } else if (msg.includes("no gps") || msg.includes("gps5 missing")) {
      userMsg = "No GPS data found in this video. Make sure GPS is enabled on your GoPro before recording.";
    } else if (msg.includes("timestamps could not")) {
      userMsg = error.message; // already user-friendly
    } else {
      userMsg = error.message || "Failed to read GoPro telemetry. Make sure the file is a valid, unmodified GoPro MP4.";
    }

    self.postMessage({ success: false, error: userMsg });
  }
};
