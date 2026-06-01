/**
 * WhatsAppEngineClient — coordinator for WhatsApp MP4 videos.
 *
 * WhatsApp videos have no telemetry and no usable creation timestamp.
 * This client extracts only structural metadata (duration, resolution, fps)
 * via a Web Worker. The ActivityPortraitPlanner drives the story from the
 * GPX file — this result just provides the clip budget.
 */

export interface WhatsAppMetadataResult {
  source:      'whatsapp';
  syncable:    false;
  durationMs:  number;
  width:       number;
  height:      number;
  fps:         number;
  codec:       string;
  isFaststart: boolean;
}

export class WhatsAppEngineClient {
  static async extractMetadata(file: File): Promise<WhatsAppMetadataResult> {
    console.log(
      `[WhatsAppEngineClient] Delegating ${file.name} ` +
      `(${(file.size / 1024 / 1024).toFixed(2)} MB) to WhatsApp Worker…`,
    );

    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('../workers/whatsapp.worker.ts', import.meta.url),
      );

      worker.onmessage = (e) => {
        const data = e.data;
        if (data.success) {
          resolve({
            source:      'whatsapp',
            syncable:    false,
            durationMs:  data.durationMs,
            width:       data.width,
            height:      data.height,
            fps:         data.fps,
            codec:       data.codec,
            isFaststart: data.isFaststart,
          });
        } else {
          console.error(`[WhatsAppEngineClient] Worker error [${data.code}]:`, data.error);
          reject(Object.assign(new Error(data.error), { code: data.code }));
        }
        worker.terminate();
      };

      worker.onerror = (e) => {
        console.error('[WhatsAppEngineClient] Worker crash:', e.message);
        reject(Object.assign(new Error('WhatsApp Worker crash: ' + e.message), { code: 'WA_READ_FAILED' }));
        worker.terminate();
      };

      worker.postMessage({ file });
    });
  }
}
