// 轻量性能监控：采样 FPS 与平均帧时间，供画质档位自适应与调试使用
export class PerformanceMonitor {
  frames = 0;
  lastReportAt = 0;
  fps = 0;
  frameMs = 0;

  // 每帧调用，now 为 performance.now()；到达采样间隔时输出一次统计
  sample(now: number, intervalMs = 1000): boolean {
    if (this.lastReportAt === 0) this.lastReportAt = now;
    this.frames += 1;
    const delta = now - this.lastReportAt;
    if (delta >= intervalMs) {
      // 间隔远超正常周期，说明经历了后台暂停（rAF 被挂起），重置基准本次不报数，
      // 避免用失真的低 fps 触发一次误降档
      if (delta > intervalMs * 3) {
        this.frames = 0;
        this.lastReportAt = now;
        return false;
      }
      this.fps = Math.round((this.frames * 1000) / delta);
      this.frameMs = delta / this.frames;
      this.frames = 0;
      this.lastReportAt = now;
      return true;
    }
    return false;
  }
}

// 画质档位：像素比与气泡由鱼缸 Renderer 读取，postProcessing 控制 Renderer 的 Bloom 后期。
// particles 预留：首页已改为视频背景，暂时没有消费者，仍参与档位单调性测试。
export type QualityTier = 'high' | 'medium' | 'low';

export const QUALITY_PRESET: Record<QualityTier, {
  maxPixelRatio: number; bubbles: number; particles: number; postProcessing: boolean;
}> = {
  high: { maxPixelRatio: 2, bubbles: 40, particles: 220, postProcessing: true },
  medium: { maxPixelRatio: 1.5, bubbles: 24, particles: 120, postProcessing: true },
  low: { maxPixelRatio: 1, bubbles: 12, particles: 60, postProcessing: false },
};

// 依据实测 FPS 自动选档：低于 30 降档，回到 55 以上逐档升回；
// 30 与 55 之间保持当前档形成回差，避免频繁切换
export function tierFromFps(fps: number, current: QualityTier): QualityTier {
  if (fps < 30 && current !== 'low') {
    return current === 'high' ? 'medium' : 'low';
  }
  if (fps >= 55 && current === 'low') return 'medium';
  if (fps >= 55 && current === 'medium') return 'high';
  return current;
}
