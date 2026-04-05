import { GPSPoint } from "../media/GoProEngineClient";
import { computeIntensity } from "./IntensityEngine";
import { detectScenes, SceneCandidate } from "./SceneDetector";

export interface HighlightSegment {
  startPoint: GPSPoint;
  endPoint: GPSPoint;
  startIndex: number;
  endIndex: number;
  videoStartTime: number; // In seconds, relative to the mp4 file
  duration: number; // In seconds
}

export interface EnhancedGPSPoint extends GPSPoint {
  hr?: number;
  cad?: number;
  power?: number;
  speed?: number; // km/h
  accel?: number; // m/s^2 (Z-axis)
  gyro?: number;  // rad/s (Yaw)
}


export interface ActionSegment extends HighlightSegment {
  title: string;
  value: string;
}

export class TelemetryCrossRef {
  static getDistance(p1: GPSPoint, p2: GPSPoint) {
    const R = 6371e3;
    const φ1 = (p1.lat * Math.PI) / 180;
    const φ2 = (p2.lat * Math.PI) / 180;
    const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180;
    const Δλ = ((p2.lon - p1.lon) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  static findHighlights(activityPoints: EnhancedGPSPoint[], videoPoints: GPSPoint[]): ActionSegment[] {
    if (videoPoints.length === 0 || activityPoints.length === 0) return [];

    const videoStart = videoPoints[0].time;
    const videoEnd   = videoPoints[videoPoints.length - 1].time;

    // ── Speed smoothing (unchanged — needed before IntensityEngine) ───────────
    for (let i = 1; i < activityPoints.length; i++) {
      if (!activityPoints[i].speed) {
        const d = this.getDistance(activityPoints[i - 1], activityPoints[i]);
        const t = (activityPoints[i].time - activityPoints[i - 1].time) / 1000;
        if (t > 0 && t < 10) activityPoints[i].speed = (d / t) * 3.6;
      }
    }
    const WINDOW = 5;
    const rawSpeeds = activityPoints.map(p => p.speed ?? 0);
    for (let i = 0; i < activityPoints.length; i++) {
      if (!activityPoints[i].speed) {
        let sum = 0, count = 0;
        for (let w = Math.max(0, i - WINDOW); w <= Math.min(activityPoints.length - 1, i + WINDOW); w++) {
          sum += rawSpeeds[w]; count++;
        }
        activityPoints[i].speed = sum / count;
      }
    }

    // ── IntensityEngine + SceneDetector ───────────────────────────────────────
    // Pass video window so scenes inside/near it get proximity boost and win deduplication.
    const intensity = computeIntensity(activityPoints);
    const scenes    = detectScenes(activityPoints, intensity, videoStart, videoEnd);

    console.log(`[TelemetryCrossRef] Profile: ${intensity.profile} | videoWindow: ${new Date(videoStart).toISOString()} → ${new Date(videoEnd).toISOString()}`);
    console.log(`[TelemetryCrossRef] Scenes detected: ${scenes.length}`);
    scenes.forEach(s => console.log(`  ${s.id} ${s.label} [${s.startIndex}→${s.endIndex}] t=${new Date(activityPoints[s.startIndex].time).toISOString()} score=${s.score.toFixed(3)}`));

    // ── Map SceneCandidate → ActionSegment (filter to video window) ───────────
    const labelFor = (s: SceneCandidate): { title: string; value: string } => {
      const m = s.metadata;
      switch (s.id) {
        case "C1": return { title: "BRUTAL CLIMB",   value: `${m.avgGradient?.toFixed(1)}%` };
        case "C2": return { title: "WILD DESCENT",   value: `${m.maxSpeed?.toFixed(1)} KM/H` };
        case "C3": return { title: "SPRINT",         value: `+${m.speedDelta?.toFixed(1)} KM/H` };
        case "C4": return { title: "TECHNICAL",      value: `${m.avgSpeed?.toFixed(1)} KM/H` };
        case "C5": return { title: "RED ZONE",       value: `${Math.round(m.avgHR ?? 0)} BPM` };
        case "C6": return { title: "FLOW",           value: `${m.climbGradient?.toFixed(1)}% → ${m.descentSpeed?.toFixed(1)} KM/H` };
        default:   return { title: s.label,            value: "" };
      }
    };

    const segments: ActionSegment[] = [];

    for (const scene of scenes) {
      const ptStart = activityPoints[scene.startIndex];
      const ptEnd   = activityPoints[scene.endIndex];

      // Only include scenes whose window overlaps with the video time range
      if (ptEnd.time < videoStart || ptStart.time > videoEnd) continue;

      // Clamp to video bounds
      const clampedStart = Math.max(ptStart.time, videoStart);
      const clampedEnd   = Math.min(ptEnd.time,   videoEnd);
      const videoStartTimeSecs = Math.max(0, (clampedStart - videoStart) / 1000);
      const duration           = Math.max(1, (clampedEnd - clampedStart) / 1000);

      const { title, value } = labelFor(scene);

      segments.push({
        startPoint:     ptStart,
        endPoint:       ptEnd,
        startIndex:     scene.startIndex,
        endIndex:       scene.endIndex,
        videoStartTime: videoStartTimeSecs,
        duration,
        title,
        value,
      });
    }

    // ── Fallback 1: no activity scenes crossed the video window ─────────────────
    // Run scene detection directly on the video GPS points (they're guaranteed to
    // be inside the video time window — no timestamp alignment needed).
    if (segments.length === 0 && videoPoints.length > 15) {
      console.log("[TelemetryCrossRef] No activity scenes overlap the video window. Trying direct detection on video GPS points...");

      // Compute speed from video GPS (not available from GPMF directly)
      const vpts = videoPoints as EnhancedGPSPoint[];
      for (let i = 1; i < vpts.length; i++) {
        if (!vpts[i].speed) {
          const d = this.getDistance(vpts[i - 1], vpts[i]);
          const t = (vpts[i].time - vpts[i - 1].time) / 1000;
          if (t > 0 && t < 10) vpts[i].speed = (d / t) * 3.6;
        }
      }

      const vIntensity = computeIntensity(vpts);
      const vScenes    = detectScenes(vpts, vIntensity);

      console.log(`[TelemetryCrossRef] Video GPS scenes: ${vScenes.length}`);
      vScenes.forEach(s => console.log(`  ${s.id} ${s.label} [${s.startIndex}→${s.endIndex}] score=${s.score.toFixed(3)}`));

      for (const scene of vScenes) {
        const ptStart = vpts[scene.startIndex];
        const ptEnd   = vpts[scene.endIndex];
        const videoStartTimeSecs = Math.max(0, (ptStart.time - videoStart) / 1000);
        const duration           = Math.max(1, (ptEnd.time - ptStart.time) / 1000);
        const { title, value }   = labelFor(scene);
        segments.push({
          startPoint:     ptStart,
          endPoint:       ptEnd,
          startIndex:     scene.startIndex,
          endIndex:       scene.endIndex,
          videoStartTime: videoStartTimeSecs,
          duration,
          title,
          value,
        });
      }
    }

    // ── Fallback 2: nothing detected at all → play full video ────────────────────
    if (segments.length === 0) {
      console.log("[TelemetryCrossRef] No scenes detected. Falling back to full video segment.");
      let s = activityPoints.findIndex(p => p.time >= videoStart);
      let e = activityPoints.findIndex(p => p.time >= videoEnd);
      if (s === -1) s = 0;
      if (e === -1) e = activityPoints.length - 1;
      segments.push({
        startPoint:     activityPoints[s],
        endPoint:       activityPoints[e],
        startIndex:     s,
        endIndex:       e,
        videoStartTime: 0,
        duration:       (videoEnd - videoStart) / 1000,
        title:          "",
        value:          "",
      });
    }

    return segments;
  }
}
