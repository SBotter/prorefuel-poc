/**
 * iPhoneEngineClient — client-side coordinator for the iPhone MOV pipeline.
 *
 * Mirrors the pattern of GoProEngineClient: delegates heavy work to a Web Worker
 * so the main thread (UI) never freezes during file processing.
 *
 * Output is fully compatible with the existing TelemetryResult interface used
 * by the GoPro pipeline. The extra fields (videoStartMs, durationMs, hasStartGPS)
 * are iPhone-specific and consumed by the iPhone validation / analyzer layer.
 */

import type { TelemetryResult } from './GoProEngineClient';

// ── Extended result for iPhone ────────────────────────────────────────────────
export interface iPhoneTelemetryResult extends TelemetryResult {
  /** Unix ms of the video's first frame (CreateDate from QuickTime metadata, UTC). */
  videoStartMs: number;
  /** Video duration in milliseconds. */
  durationMs: number;
  /** Whether the iPhone had Location Services enabled during recording. */
  hasStartGPS: boolean;
}

export class iPhoneEngineClient {
  /**
   * Extracts video metadata from an iPhone MOV file by delegating to a Web Worker.
   * Returns a normalized TelemetryResult-compatible structure.
   *
   * Rejects with an error whose `.code` property is one of:
   *   'IPHONE_READ_FAILED' | 'IPHONE_NO_TIMESTAMP' | 'IPHONE_INVALID_DATE' | 'IPHONE_NO_DURATION'
   */
  static async extractTelemetry(file: File): Promise<iPhoneTelemetryResult> {
    console.log(
      `[iPhoneEngineClient] Delegating ${file.name} ` +
      `(${(file.size / 1024 / 1024).toFixed(2)} MB) to iPhone Worker...`,
    );

    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('../workers/iphone.worker.ts', import.meta.url),
      );

      worker.onmessage = (e) => {
        const data = e.data;

        if (data.success) {
          const {
            points,
            syncPoints,
            cameraModel,
            gpsVideoOffsetMs,
            videoStartMs,
            durationMs,
            hasStartGPS,
          } = data;

          console.log(
            `[iPhoneEngineClient] Worker done — model="${cameraModel}" ` +
            `start=${new Date(videoStartMs).toISOString()} ` +
            `duration=${(durationMs / 1000).toFixed(0)}s ` +
            `hasStartGPS=${hasStartGPS}`,
          );

          resolve({
            points,
            syncPoints,
            cameraModel,
            gpsVideoOffsetMs,
            videoStartMs,
            durationMs,
            hasStartGPS,
          });
        } else {
          console.error(
            `[iPhoneEngineClient] Worker error [${data.code}]:`,
            data.error,
          );
          const err = Object.assign(new Error(data.error), { code: data.code });
          reject(err);
        }

        worker.terminate();
      };

      worker.onerror = (e) => {
        console.error('[iPhoneEngineClient] Worker crash:', e.message);
        reject(
          Object.assign(new Error('iPhone Worker crash: ' + e.message), {
            code: 'IPHONE_READ_FAILED',
          }),
        );
        worker.terminate();
      };

      worker.postMessage({ file });
    });
  }
}
