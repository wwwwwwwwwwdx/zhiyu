import { describe, it, expect } from 'vitest';
import { summarizeFrames } from '../src/app/analytics/perfProbe';

const meta = {
  seconds: 2,
  devicePixelRatio: 1,
  webglRenderer: 'test-renderer',
  userAgent: 'test-agent',
  capturedAt: '2026-11-10T00:00:00.000Z',
};

describe('性能探针统计', () => {
  it('等间隔帧得到稳定 FPS 且无慢帧', () => {
    const deltas = Array(120).fill(1000 / 60);
    const report = summarizeFrames(deltas, [60, 60], meta);
    expect(report.frames).toBe(120);
    expect(report.avgFps).toBe(60);
    expect(report.slowFrames).toBe(0);
    expect(report.minFps).toBe(60);
  });

  it('慢帧、P95 帧时与最差秒窗口统计正确', () => {
    const deltas = [...Array(90).fill(16), ...Array(10).fill(50)];
    const report = summarizeFrames(deltas, [50, 50], meta);
    expect(report.slowFrames).toBe(10);
    expect(report.p95FrameMs).toBe(50);
    expect(report.maxFrameMs).toBe(50);
    expect(report.minFps).toBe(50);
  });

  it('无采样帧时返回零值而不抛错', () => {
    const report = summarizeFrames([], [], meta);
    expect(report.frames).toBe(0);
    expect(report.avgFps).toBe(0);
    expect(report.p95FrameMs).toBe(0);
    expect(report.minFps).toBe(0);
  });
});
