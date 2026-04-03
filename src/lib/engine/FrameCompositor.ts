/**
 * Orquestrador Matemático de Frames
 * Responsável por fundir (Composite) o Canvas Mapbox, o Vídeo MP4 e Desenhar a Telemetria diretamente no Canvas Meste (1080x1920).
 */

export class FrameCompositor {
    
    static easeOutCubic(t: number): number {
        const t1 = t - 1;
        return t1 * t1 * t1 + 1;
    }

    /**
     * Extrai a Matrix de transformação bezier baseada no tempo do frame
     * Exatamente para copiar a transição "escada" da Fase 3 puramente em Canvas.
     */
    static computeLayout(timeMs: number, transitionStartMs: number, isAction: boolean) {
        // Exemplo rudimentar estrutural futuro:
        const progress = Math.min(1, Math.max(0, (timeMs - transitionStartMs) / 1000));
        const eased = this.easeOutCubic(progress);

        // Se isAction é VERDADEIRO:
        // scale varia de 1.0 para 0.42
        const targetScale = isAction ? (1.0 - (0.58 * eased)) : (0.42 + (0.58 * eased));
        
        return {
            scale: targetScale,
        };
    }

    /**
     * Pinta cruamente letrinhas brancas de 4K direto num Frame Mestre.
     */
    static renderTelemetry(ctx: CanvasRenderingContext2D, speed: number, distance: number) {
        ctx.save();
        ctx.font = "italic 900 180px sans-serif";
        ctx.fillStyle = "white";
        ctx.shadowColor = "rgba(0,0,0,1)";
        ctx.shadowBlur = 40;
        ctx.shadowOffsetY = 10;
        
        ctx.fillText(distance.toFixed(2), 120, 300);
        
        ctx.font = "900 60px sans-serif";
        ctx.fillStyle = "#f59e0b"; // Amber-500
        ctx.fillText("KM", 560, 300);

        ctx.restore();
    }
}
