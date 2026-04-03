import gpmfExtract from 'gpmf-extract';
import goproTelemetry from 'gopro-telemetry';

self.onmessage = async (e: MessageEvent) => {
  try {
    const file = e.data.file;
    
    // Processado na Thread em Background!
    const extracted = await gpmfExtract(file, { browserMode: true });
    
    if (!extracted || !extracted.rawData) {
      throw new Error("Trilha GPMF vazia ou corrompida.");
    }

    const telemetry = await goproTelemetry(extracted, { stream: ['GPS5', 'ACCL', 'GYRO'] });

    
    const deviceIds = Object.keys(telemetry);
    if (deviceIds.length === 0) throw new Error("Nenhum sensor de telemetria retornado.");
    
    const streams = (telemetry as any)[deviceIds[0]]?.streams;
    if (!streams || !streams.GPS5 || !streams.GPS5.samples) {
       throw new Error("Nenhuma trilha de coordenadas GPS localizada (GPS5 Missing).");
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
      throw new Error("Nenhum ponto GPS válido encontrado. O vídeo não possui telemetria GPS embutida.");
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

    self.postMessage({ success: true, points: downsampled });
  } catch (error: any) {
    self.postMessage({ success: false, error: error.message || "Erro desconhecido no Worker." });
  }
};
