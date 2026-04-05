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

    // Filter out malformed samples (null value, wrong length, or invalid coords)
    const validSamples = rawSamples.filter((sample: any) => {
      if (!sample || !Array.isArray(sample.value) || sample.value.length < 3) return false;
      const lat = Number(sample.value[0]);
      const lon = Number(sample.value[1]);
      return isFinite(lat) && isFinite(lon) && (lat !== 0 || lon !== 0) && sample.date;
    });

    if (validSamples.length === 0) {
      throw new Error("No valid GPS points found. This video has no embedded GPS telemetry.");
    }

    const points = validSamples.map((sample: any, i: number) => ({
      lat: Number(sample.value[0]),
      lon: Number(sample.value[1]),
      ele: Number(sample.value[2]),
      time: new Date(sample.date).getTime(),
      accel: streams.ACCL?.samples?.[i]?.value?.[2],
      gyro: streams.GYRO?.samples?.[i]?.value?.[2],
    }));


    const downsampled: any[] = [];
    let lastTime = 0;
    for (const pt of points) {
       if (pt.time - lastTime >= 1000) {
          downsampled.push(pt);
          lastTime = pt.time;
       }
    }

    self.postMessage({ success: true, points: downsampled, cameraModel });
  } catch (error: any) {
    self.postMessage({ success: false, error: error.message || "Unknown worker error." });
  }
};
