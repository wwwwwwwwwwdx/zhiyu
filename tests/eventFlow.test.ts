import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine';

describe('引擎事件流', () => {
  it('多次读取快照不会吞掉尚未展示的命令事件', () => {
    const engine = createEngine();
    engine.startCycling();
    const first = engine.getSnapshot().events;
    const second = engine.getSnapshot().events;
    expect(first).toContain('开始养水：硝化系统建立中');
    expect(second).toEqual(first);
  });

  it('drainEvents 消费一次后清空，事件不会重复进入时间线', () => {
    const engine = createEngine();
    engine.changeWater(0.3);
    const pending = engine.getSnapshot().events;
    expect(pending.some((e) => e.includes('换水'))).toBe(true);
    expect(engine.drainEvents()).toEqual(pending);
    expect(engine.drainEvents()).toEqual([]);
    expect(engine.getSnapshot().events).toEqual([]);
  });

  it('命令事件与 tick 事件合并后一次性交付 UI', () => {
    const engine = createEngine();
    engine.changeWater(0.3);
    engine.advance(0.1);
    const events = engine.drainEvents();
    expect(events.some((e) => e.includes('换水'))).toBe(true);
    expect(events).toEqual([...new Set(events)]);
  });

  it('离线摘要独立消费事件，不会残留到前台事件流', () => {
    const engine = createEngine();
    engine.startCycling();
    const result = engine.fastForward(60);
    expect(Array.isArray(result.events)).toBe(true);
    expect(engine.getSnapshot().events).not.toContain('开始养水：硝化系统建立中');
  });
});
