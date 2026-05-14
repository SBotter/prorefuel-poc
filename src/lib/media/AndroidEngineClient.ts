/**
 * AndroidEngineClient — client-side coordinator for the Android MP4 pipeline.
 *
 * Mirrors iPhoneEngineClient: delegates to a Web Worker so the main thread
 * never freezes during file processing.
 *
 * Output is compatible with iPhoneTelemetryResult — the pipeline treats
 * Android videos identically to iPhone (timestamp-based sync, no GPS track).
 */

import type { TelemetryResult } from './GoProEngineClient';

export interface AndroidTelemetryResult extends TelemetryResult {
  videoStartMs:  number;
  durationMs:    number;
  hasStartGPS:   boolean;
}

export class AndroidEngineClient {
  static async extractTelemetry(file: File): Promise<AndroidTelemetryResult> {
    console.log(
      `[AndroidEngineClient] Delegating ${file.name} ` +
      `(${(file.size / 1024 / 1024).toFixed(2)} MB) to Android Worker...`,
    );

    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('../workers/android.worker.ts', import.meta.url),
      );

      worker.onmessage = (e) => {
        const data = e.data;

        if (data.success) {
          const { points, syncPoints, cameraModel, gpsVideoOffsetMs, videoStartMs, durationMs, hasStartGPS } = data;
          console.log(
            `[AndroidEngineClient] Worker done — model="${cameraModel}" ` +
            `start=${new Date(videoStartMs).toISOString()} ` +
            `duration=${(durationMs / 1000).toFixed(0)}s`,
          );
          resolve({ points, syncPoints, cameraModel, gpsVideoOffsetMs, videoStartMs, durationMs, hasStartGPS });
        } else {
          console.error(`[AndroidEngineClient] Worker error [${data.code}]:`, data.error);
          const err = Object.assign(new Error(data.error), { code: data.code });
          reject(err);
        }

        worker.terminate();
      };

      worker.onerror = (e) => {
        console.error('[AndroidEngineClient] Worker crash:', e.message);
        reject(Object.assign(new Error('Android Worker crash: ' + e.message), { code: 'ANDROID_READ_FAILED' }));
        worker.terminate();
      };

      worker.postMessage({ file });
    });
  }
}
