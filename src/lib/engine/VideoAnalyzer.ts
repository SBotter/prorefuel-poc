import { GPSPoint } from "@/lib/media/GoProEngine";

export interface HighlightSegment {
  startPoint: GPSPoint;
  endPoint: GPSPoint;
  startTimeInVideo: number; // Segundos desde o início do vídeo
  duration: number; // Duração do segmento em segundos
  elevationGain: number; // Ganho total de altitude (m)
  averageGrade: number; // Inclinação média (%)
}

export class VideoAnalyzer {
  static getEntireVideoSegment(points: GPSPoint[]): HighlightSegment {
    if (points.length < 2) {
      throw new Error("Dados de GPS insuficientes para análise.");
    }

    const start = points[0];
    const end = points[points.length - 1];
    const maxGain = end.ele - start.ele;
    const distance = this.calculateDistance(start.lat, start.lon, end.lat, end.lon);
    const grade = distance > 0 ? (maxGain / distance) * 100 : 0;

    return {
      startPoint: start,
      endPoint: end,
      startTimeInVideo: 0,
      duration: (end.time - start.time) / 1000,
      elevationGain: maxGain,
      averageGrade: parseFloat(grade.toFixed(2)),
    };
  }

  /**
   * Analisa o rastro de GPS do vídeo para encontrar a "Maior Subida".
   * O critério é o maior ganho de elevação acumulado em um intervalo de tempo.
   */
  static findSteepestSegment(
    points: GPSPoint[],
    windowSeconds: number = 10,
  ): HighlightSegment {
    if (points.length < 2) {
      throw new Error("Dados de GPS insuficientes para análise.");
    }

    let maxGain = -Infinity;
    let bestStartIndex = 0;
    let bestEndIndex = 0;

    // Janela deslizante (Sliding Window) para encontrar o maior ganho de elevação
    // Consideramos a taxa de amostragem do ExifTool (geralmente 1Hz ou 10Hz com -ee3)
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const timeDiff = (points[j].time - points[i].time) / 1000;

        // Procuramos o maior ganho dentro da janela de tempo solicitada (ex: 10s de vídeo)
        if (timeDiff >= windowSeconds) {
          const gain = points[j].ele - points[i].ele;

          if (gain > maxGain) {
            maxGain = gain;
            bestStartIndex = i;
            bestEndIndex = j;
          }
          break; // Passa para o próximo ponto inicial
        }
      }
    }

    const start = points[bestStartIndex];
    const end = points[bestEndIndex];

    // Cálculo de Inclinação (Grade %)
    // Distância aproximada entre dois pontos (Haversine simplificado para distâncias curtas)
    const distance = this.calculateDistance(
      start.lat,
      start.lon,
      end.lat,
      end.lon,
    );
    const grade = distance > 0 ? (maxGain / distance) * 100 : 0;

    return {
      startPoint: start,
      endPoint: end,
      startTimeInVideo: (start.time - points[0].time) / 1000,
      duration: (end.time - start.time) / 1000,
      elevationGain: maxGain,
      averageGrade: parseFloat(grade.toFixed(2)),
    };
  }

  /**
   * Calcula a distância em metros entre duas coordenadas (Fórmula de Haversine).
   */
  private static calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371e3; // Raio da Terra em metros
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }
}
