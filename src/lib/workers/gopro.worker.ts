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

    const telemetry = await goproTelemetry(extracted, { stream: ['GPS5'] });
    
    const deviceIds = Object.keys(telemetry);
    if (deviceIds.length === 0) throw new Error("Nenhum sensor de telemetria retornado.");
    
    const streams = (telemetry as any)[deviceIds[0]]?.streams;
    if (!streams || !streams.GPS5 || !streams.GPS5.samples) {
       throw new Error("Nenhuma trilha de coordenadas GPS localizada (GPS5 Missing).");
    }

    const points = streams.GPS5.samples.map((sample: any) => ({
      lat: typeof sample.value[0] === "number" ? sample.value[0] : parseFloat(sample.value[0]),
      lon: typeof sample.value[1] === "number" ? sample.value[1] : parseFloat(sample.value[1]),
      ele: typeof sample.value[2] === "number" ? sample.value[2] : parseFloat(sample.value[2]),
      time: new Date(sample.date).getTime()
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
