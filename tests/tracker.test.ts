import { describe, it, expect, beforeEach } from 'vitest';
import {
  track, setAnalyticsSink, LocalStorageSink,
  type AnalyticsSink, type AnalyticsEvent,
} from '../src/app/analytics/tracker';

// 内存 sink：记录全部事件，验证分发
class MemorySink implements AnalyticsSink {
  events: AnalyticsEvent[] = [];
  send(event: AnalyticsEvent): void {
    this.events.push(event);
  }
}

// 为 LocalStorageSink 提供内存版 localStorage
function mockLocalStorage(): void {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe('埋点 tracker', () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it('track 事件被当前 sink 接收并带时间戳', () => {
    const memory = new MemorySink();
    setAnalyticsSink(memory);
    track('feed', { amount: 1 });
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0].name).toBe('feed');
    expect(memory.events[0].at).toBeGreaterThan(0);
    expect(memory.events[0].props).toEqual({ amount: 1 });
  });

  it('LocalStorageSink 持久化并保留最近事件', () => {
    const sink = new LocalStorageSink();
    setAnalyticsSink(sink);
    track('water_change');
    track('feed');
    const stored = sink.read();
    expect(stored).toHaveLength(2);
    expect(stored[0].name).toBe('water_change');
    sink.clear();
    expect(sink.read()).toHaveLength(0);
  });
});
