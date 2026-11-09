import { describe, it, expect } from 'vitest';
import { CanvasRecorder } from '../src/render/CanvasRecorder';

describe('CanvasRecorder 能力检测', () => {
  it('在缺少 captureStream/MediaRecorder 的环境返回不支持，而非抛错', () => {
    // Vitest node 环境无 HTMLCanvasElement，能力检测应安全降级为 false
    expect(CanvasRecorder.isSupported()).toBe(false);
  });
});
