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

// 画质档位：控制像素比上限与重开销效果，对应渲染文档的降级策略
export type QualityTier = 'high' | 'medium' | 'low';

export const QUALITY_PRESET: Record<QualityTier, { maxPixelRatio: number; particles: number; postProcessing: boolean }> = {
  high: { maxPixelRatio: 2, particles: 220, postProcessing: true },
  medium: { maxPixelRatio: 1.5, particles: 120, postProcessing: false },
  low: { maxPixelRatio: 1, particles: 60, postProcessing: false },
};

// 依据实测 FPS 自动选档：低于阈值下调，留滞后避免频繁切换
export function tierFromFps(fps: number, current: QualityTier): QualityTier {
  if (fps < 30 && current !== 'low') {
    return current === 'high' ? 'medium' : 'low';
  }
  return current;
}
