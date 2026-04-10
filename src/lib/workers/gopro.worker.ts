import gpmfExtract from 'gpmf-extract';
import goproTelemetry from 'gopro-telemetry';

self.onmessage = async (e: MessageEvent) => {
  try {
    const file = e.data.file;
    
    // Processado na Thread em Background!
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

    // Filter out malformed / invalid GPS samples.
    // Stronger than the old (lat !== 0 || lon !== 0) check:
    //   • |lat| < 0.0001 and |lon| < 0.0001 → null-island or GPS completely cold
    //   • speed > 150 km/h → GPS spike (unrealistic for MTB / cycling context)
    //   • missing .date → gopro-telemetry couldn't assign a GPS UTC timestamp
    const validSamples = rawSamples.filter((sample: any) => {
      if (!sample || !Array.isArray(sample.value) || sample.value.length < 3) return false;
      const lat = Number(sample.value[0]);
      const lon = Number(sample.value[1]);
      const spdKmh = Number(sample.value[3]) * 3.6; // GPS5[3] = 2D speed in m/s
      return (
        isFinite(lat) && isFinite(lon)
        && Math.abs(lat) > 0.0001 && Math.abs(lon) > 0.0001  // reject null-island & cold-start zeros
        && sample.date
        && (isNaN(spdKmh) || spdKmh <= 150)                  // reject GPS speed spikes
      );
    });

    // ── GPS startup offset: find when GPS actually locked using fix field ─────
    // GPS5 samples carry a sticky "fix" field: 0=no fix, 2=2D fix, 3=3D fix.
    // "Sticky" means the value persists until explicitly changed by a later sample.
    // gpsVideoOffsetMs = CTS (video-relative ms) of the first locked sample.
    // For no-GPS-lock videos (fix=0 throughout), page.tsx applies a position-based
    // clock offset correction using the activity GPS track as reference.
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
      // Prefer per-sample CTS (ms from video start) — precise to the individual GPS5 sample.
      // Fall back to chunk-level CTS only if the per-sample field is absent (older firmware).
      const sampleCts = rawSamples[firstLockedIdx]?.cts;
      if (typeof sampleCts === 'number') {
        gpsVideoOffsetMs = sampleCts;
        console.log(`[Worker] GPS lock at sample ${firstLockedIdx} → per-sample CTS=${gpsVideoOffsetMs}ms`);
      } else if (chunks.length > 0) {
        const samplesPerChunk = rawSamples.length / chunks.length;
        const chunkIdx = Math.min(Math.floor(firstLockedIdx / samplesPerChunk), chunks.length - 1);
        // Interpolate within the chunk: sample position within chunk → fractional CTS offset
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
      throw new Error("No valid GPS points found. This video has no embedded GPS telemetry.");
    }

    // ACCL runs at ~200 Hz, GPS5 at ~18 Hz — map by time ratio, not index
    const accelSamples: any[] = streams.ACCL?.samples ?? [];
    const gyroSamples:  any[] = streams.GYRO?.samples  ?? [];
    const accelLen = accelSamples.length;
    const gyroLen  = gyroSamples.length;

    const points = validSamples.map((sample: any, i: number) => {
      // Ratio-based index mapping
      const ratio = rawSamples.length > 1 ? rawSamples.indexOf(sample) / (rawSamples.length - 1) : 0;
      const aIdx = Math.min(Math.round(ratio * (accelLen - 1)), accelLen - 1);
      const gIdx = Math.min(Math.round(ratio * (gyroLen  - 1)), gyroLen  - 1);
      const av = accelSamples[aIdx]?.value;
      const gv = gyroSamples[gIdx]?.value;
      // 3D magnitude for ACCL; GPS5 value[3] = 2D speed in m/s → km/h
      const accel = av ? Math.sqrt(av[0]**2 + av[1]**2 + av[2]**2) : undefined;
      const gyro  = gv ? Math.abs(gv[2]) : undefined;
      return {
        lat:   Number(sample.value[0]),
        lon:   Number(sample.value[1]),
        ele:   Number(sample.value[2]),
        time:  new Date(sample.date).getTime(),
        speed: Number(sample.value[3]) * 3.6, // m/s → km/h
        accel,
        gyro,
      };
    });


    // 1Hz points for map rendering (lightweight, used by MapEngine and scene detection)
    const downsampled: any[] = [];
    let lastTime = 0;
    for (const pt of points) {
       if (pt.time - lastTime >= 1000) {
          downsampled.push(pt);
          lastTime = pt.time;
       }
    }

    // ── syncPoints: ~4.5 Hz, post-lock only, first-2 jitter dropped ─────────────
    // Purpose: clean, high-res signal for any future alignment use.
    // • Pre-lock samples have stale cached positions → removed
    // • First 2 post-lock samples may still jitter during oscillator warm-up → dropped
    // • Not used for rendering; not sent to map or scene detectors
    const SYNC_INTERVAL_MS = 220; // ~4.5 Hz from 18 Hz source
    const rawSyncPoints: any[] = [];
    let lastSyncTime = -Infinity;
    for (const pt of points) {
      if (pt.time - lastSyncTime >= SYNC_INTERVAL_MS) {
        rawSyncPoints.push(pt);
        lastSyncTime = pt.time;
      }
    }
    // Compute lock time in GPS UTC (same domain as points[].time)
    const lockTimeMs = points.length > 0 ? points[0].time + gpsVideoOffsetMs : 0;
    let syncPoints = lockTimeMs > 0
      ? rawSyncPoints.filter(pt => pt.time >= lockTimeMs)
      : rawSyncPoints;
    // Drop first 2 post-lock points — GPS oscillator still stabilising
    if (syncPoints.length > 4) syncPoints = syncPoints.slice(2);

    // ── Debug instrumentation ─────────────────────────────────────────────────
    console.log('[Worker] GPS pipeline summary:', {
      rawSamples:        rawSamples.length,
      validSamples:      validSamples.length,
      droppedInvalid:    rawSamples.length - validSamples.length,
      downsampled1Hz:    downsampled.length,
      syncPoints4Hz:     syncPoints.length,
      gpsVideoOffsetMs:  Math.round(gpsVideoOffsetMs),
      firstValidTime:    downsampled.length > 0 ? new Date(downsampled[0].time).toISOString() : 'n/a',
      firstPostLockTime: syncPoints.length  > 0 ? new Date(syncPoints[0].time).toISOString()  : 'n/a',
      lockTimeUTC:       lockTimeMs > 0          ? new Date(lockTimeMs).toISOString()          : 'n/a',
    });

    self.postMessage({ success: true, points: downsampled, syncPoints, cameraModel, gpsVideoOffsetMs });
  } catch (error: any) {
    self.postMessage({ success: false, error: error.message || "Unknown worker error." });
  }
};
