import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEngine } from '../src/engine/engine';

afterEach(() => vi.restoreAllMocks());

describe('离线分批推演', () => {
  it('异步版与同步版在固定随机序列下状态完全一致', async () => {
    let seed = 1;
    const seeded = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    vi.spyOn(Math, 'random').mockImplementation(seeded);

    const syncEngine = createEngine();
    syncEngine.startCycling();
    const syncResult = syncEngine.fastForward(6000);
    const syncState = syncEngine.getPersistedState(0);

    seed = 1;
    const asyncEngine = createEngine();
    asyncEngine.startCycling();
    const asyncResult = await asyncEngine.fastForwardAsync(6000);
    const asyncState = asyncEngine.getPersistedState(0);

    expect(asyncResult.awayGameSeconds).toBe(syncResult.awayGameSeconds);
    expect(asyncState.gameTime).toBe(syncState.gameTime);
    expect(asyncState.water).toEqual(syncState.water);
    expect(asyncState.coins).toBe(syncState.coins);
    expect(asyncState.nitrogenEstablished).toBe(syncState.nitrogenEstablished);
    expect(asyncResult.events).toEqual([...new Set(asyncResult.events)]);
  });

  it('长时推演分批让出主线程', async () => {
    const engine = createEngine();
    let yields = 0;
    const result = await engine.fastForwardAsync(4000, async () => { yields += 1; });
    expect(yields).toBe(2); // 4000 / 1500 共 3 批，批间让出 2 次
    expect(result.awayGameSeconds).toBe(4000);
    expect(Array.isArray(result.events)).toBe(true);
  });

  it('不足整 tick 的时长按整 tick 计算', async () => {
    const engine = createEngine();
    const result = await engine.fastForwardAsync(125.9);
    expect(result.awayGameSeconds).toBe(125);
  });
});
