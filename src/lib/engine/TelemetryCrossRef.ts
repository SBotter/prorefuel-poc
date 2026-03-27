import { GPSPoint } from "../media/GoProEngineClient";

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
    const videoEnd = videoPoints[videoPoints.length - 1].time;

    // Calcula velocidades da atividade filtrando rúidos de GPS (Jitter)
    const rawSpeeds: number[] = new Array(activityPoints.length).fill(0);
    for (let i = 1; i < activityPoints.length; i++) {
        if (activityPoints[i].speed) {
            // Se o arquivo já tem 'speed' gravado pelo Garmin, usa o dele!
            rawSpeeds[i] = activityPoints[i].speed!;
        } else {
            const d = this.getDistance(activityPoints[i - 1], activityPoints[i]);
            const t = (activityPoints[i].time - activityPoints[i - 1].time) / 1000;
            // Descarta pulos absurdos de mais de 10s (ex: Pausou o relógio ou perdeu satélite)
            if (t > 0 && t < 10) rawSpeeds[i] = (d / t) * 3.6;
        }
    }

    // Aplica o "Filtro de Média Móvel" (Rolling Average de janela 5) para suavizar
    const WINDOW = 5;
    for (let i = 0; i < activityPoints.length; i++) {
       let sum = 0;
       let count = 0;
       for (let w = Math.max(0, i - WINDOW); w <= Math.min(activityPoints.length - 1, i + WINDOW); w++) {
          sum += rawSpeeds[w];
          count++;
       }
       // Só substitui a velocidade se o array nativo não tinha uma gravada por sensor magnético
       if (!activityPoints[i].speed) {
           activityPoints[i].speed = sum / count;
       }
    }

    // Busca os picos isolados APENAS DENTRO do recorte de tempo do Vídeo
    let maxHrPt: EnhancedGPSPoint | null = null;
    let maxPowerPt: EnhancedGPSPoint | null = null;
    let maxSpeedPt: EnhancedGPSPoint | null = null;

    const videoPointsInGPX = activityPoints.filter(p => p.time >= videoStart && p.time <= videoEnd);

    for (const pt of videoPointsInGPX) {
      if (pt.hr && (!maxHrPt || pt.hr > maxHrPt.hr!)) maxHrPt = pt;
      if (pt.power && (!maxPowerPt || pt.power > maxPowerPt.power!)) maxPowerPt = pt;
      if (pt.speed && (!maxSpeedPt || pt.speed > maxSpeedPt.speed!)) maxSpeedPt = pt;
    }

    const segments: ActionSegment[] = [];

    // Função local para checar se o pico fisiológico ocorreu ENQUANTO a GoPro gravava
    const processPeak = (peak: EnhancedGPSPoint | null, titleStr: string, valueStr: string) => {
      if (!peak) return;
      // Estabelece a Cena do Clímax: 5s antes do pico até 5s depois (Total 10s)
      const clipStart = peak.time - 5000;
      const clipEnd = peak.time + 5000;

      // O pico esteve dentro do vídeo?
      if (peak.time >= videoStart && peak.time <= videoEnd) {
        // Encontra o Index do mapa onde a cena começa e termina
        let mapIdx = activityPoints.findIndex(p => p.time >= clipStart);
        let endIdx = activityPoints.findIndex(p => p.time >= clipEnd);

        if (mapIdx === -1) mapIdx = 0;
        if (endIdx === -1) endIdx = activityPoints.length - 1;

        // Identifica onde exatamente fazer o "seek" no MP4
        const videoStartTimeSecs = Math.max(0, (clipStart - videoStart) / 1000);

        segments.push({
          startPoint: activityPoints[mapIdx],
          endPoint: activityPoints[endIdx],
          startIndex: mapIdx,
          endIndex: endIdx,
          videoStartTime: videoStartTimeSecs,
          duration: 10,
          title: titleStr,
          value: valueStr
        });
      }
    };

    processPeak(maxHrPt, "MAX HEART RATE", `${maxHrPt?.hr} BPM`);
    processPeak(maxPowerPt, "MAX POWER", `${maxPowerPt?.power} W`);
    processPeak(maxSpeedPt, "MAX SPEED", `${maxSpeedPt?.speed?.toFixed(1)} KM/H`);

    // Remove overlapping segments (Múltiplos picos próximos podem causar sobreposição no mesmo trecho temporal)
    const filteredSegments: ActionSegment[] = [];
    for (const seg of segments.sort((a, b) => a.startIndex - b.startIndex)) {
      const isOverlapping = filteredSegments.some(f => seg.startIndex < f.endIndex && seg.endIndex > f.startIndex);
      if (!isOverlapping) {
        filteredSegments.push(seg);
      }
    }

    // Fallback: Se não houve NENHUM pico biológico que calhasse com o vídeo, 
    // ou se o GPX era simples demais sem sensores, toca o Vídeo Inteiro como 1 grande Highlight!
    if (filteredSegments.length === 0) {
      console.log("[TelemetryCrossRef] Nenhum pico cruzou com o vídeo. Gerando Full Action Segment.");
      let mapStartIdx = activityPoints.findIndex(p => p.time >= videoStart);
      let mapEndIdx = activityPoints.findIndex(p => p.time >= videoEnd);

      if (mapStartIdx === -1) mapStartIdx = 0;
      if (mapEndIdx === -1) mapEndIdx = activityPoints.length - 1;

      filteredSegments.push({
        startPoint: activityPoints[mapStartIdx],
        endPoint: activityPoints[mapEndIdx],
        startIndex: mapStartIdx,
        endIndex: mapEndIdx,
        videoStartTime: 0,
        duration: (videoEnd - videoStart) / 1000,
        title: "",
        value: ""
      });
    }

    return filteredSegments;
  }
}
