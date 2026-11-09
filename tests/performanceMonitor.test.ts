import { describe, it, expect } from 'vitest';
import { PerformanceMonitor, tierFromFps } from '../src/render/PerformanceMonitor';

const FRAME = 1000 / 60;

// 跑约 1 秒并留余量，确保跨过采样阈值；返回是否触发与触发时 FPS
function runOneSecond(monitor: PerformanceMonitor, startAt: number): { reported: boolean } {
  let now = startAt;
  let reported = false;
  for (let i = 0; i < 62; i += 1) {
    if (monitor.sample(now)) reported = true;
    now += FRAME;
  }
  return { reported };
}

describe('PerformanceMonitor', () => {
  it('正常采样计算 FPS（约 60）', () => {
    const monitor = new PerformanceMonitor();
    const { reported } = runOneSecond(monitor, 1000);
    expect(reported).toBe(true);
    expect(monitor.fps).toBeGreaterThanOrEqual(58);
    expect(monitor.fps).toBeLessThanOrEqual(62);
  });

  it('后台暂停恢复时本次不报数并重置基准，避免误降档', () => {
    const monitor = new PerformanceMonitor();
    runOneSecond(monitor, 1000);
    // 模拟挂起 10 秒后的首个采样：不报数、基准重置
    expect(monitor.sample(12000)).toBe(false);
    expect(monitor.lastReportAt).toBe(12000);
    // 下一个正常周期可正常报数
    const { reported } = runOneSecond(monitor, 12000);
    expect(reported).toBe(true);
    expect(monitor.fps).toBeGreaterThanOrEqual(58);
    expect(monitor.fps).toBeLessThanOrEqual(62);
  });

  it('tierFromFps 低帧降档且不越过 low', () => {
    expect(tierFromFps(20, 'high')).toBe('medium');
    expect(tierFromFps(20, 'medium')).toBe('low');
    expect(tierFromFps(20, 'low')).toBe('low');
    expect(tierFromFps(55, 'high')).toBe('high');
  });
});
