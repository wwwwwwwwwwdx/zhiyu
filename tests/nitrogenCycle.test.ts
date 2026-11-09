import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine';
import { FISH_CATALOG } from '../src/engine/balance/catalog';
import type { Engine } from '../src/engine/core/types';

// 统一前置：完成开缸养水，硝化建立后返回可放鱼的引擎
function cycledEngine(): Engine {
  const engine = createEngine();
  engine.startCycling();
  engine.fastForward(60 * 60 * 2);
  return engine;
}

describe('模拟引擎 M1', () => {
  it('空缸喂食被拒绝', () => {
    expect(createEngine().feed(1).ok).toBe(false);
  });

  it('买鱼成功并扣减金币，随后喂食使饥饿度下降', () => {
    const engine = cycledEngine();
    const coinsBefore = engine.getSnapshot().coins;
    expect(engine.buyFish('guppy').ok).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.fishes).toHaveLength(1);
    // 买鱼扣 12，同时触发初次相遇成就奖励 20，净 +8
    expect(snap.coins).toBe(coinsBefore - 12 + 20);

    const hungerBefore = snap.fishes[0].hunger;
    expect(engine.feed(2).ok).toBe(true);
    expect(engine.getSnapshot().fishes[0].hunger).toBeLessThan(hungerBefore);
  });

  it('资源耗尽（密度或金币）时购买被拒', () => {
    const engine = cycledEngine();
    let result = engine.buyFish('guppy');
    for (let i = 0; i < 100 && result.ok; i += 1) {
      result = engine.buyFish('guppy');
    }
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('混养冲突被拦截：神仙鱼与虎皮鱼', () => {
    const engine = cycledEngine();
    expect(engine.buyFish('angelfish').ok).toBe(true);
    const result = engine.buyFish('tiger-barb');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('混养');
  });

  it('装备购买后可安装，参数作用于引擎', () => {
    const engine = createEngine();
    expect(engine.buyEquipment('filter-canister').ok).toBe(true);
    expect(engine.installEquipment('filter-canister').ok).toBe(true);
    expect(engine.getSnapshot().installed.filter).toBe('filter-canister');
  });

  it('推进后游戏时间增长且水质参数非负', () => {
    const engine = cycledEngine();
    engine.buyFish('zebra');
    const snap = engine.advance(1);
    expect(snap.gameTime).toBeGreaterThan(0);
    expect(snap.water.nh3).toBeGreaterThanOrEqual(0);
  });

  it('换水稀释硝酸盐', () => {
    const engine = cycledEngine();
    engine.buyFish('guppy');
    engine.advance(5);
    const before = engine.getSnapshot().water.no3;
    expect(engine.changeWater(1 / 3).ok).toBe(true);
    expect(engine.getSnapshot().water.no3).toBeLessThanOrEqual(before);
  });

  it('相同命令序列下快照确定性一致', () => {
    const a = cycledEngine();
    const b = cycledEngine();
    a.buyFish('neon');
    b.buyFish('neon');
    expect(a.advance(2).water).toEqual(b.advance(2).water);
  });

  it('持久化后恢复，引擎状态与原快照一致', () => {
    const engine = cycledEngine();
    engine.buyFish('guppy');
    engine.advance(3);
    const persisted = engine.getPersistedState(Date.now());
    const restored = createEngine(persisted);
    expect(restored.getSnapshot().water).toEqual(engine.getSnapshot().water);
    expect(restored.getSnapshot().fishes).toHaveLength(1);
  });

  it('fastForward 推进游戏时间并返回离线结果结构', () => {
    const engine = cycledEngine();
    engine.buyFish('zebra');
    const result = engine.fastForward(600);
    expect(result.awayGameSeconds).toBe(600);
    expect(Array.isArray(result.events)).toBe(true);
    expect(engine.getSnapshot().gameTime).toBe(600 + 60 * 60 * 2);
  });

  it('群游不足时给出提示', () => {
    const engine = cycledEngine();
    engine.buyFish('neon'); // minSchool 3，仅 1 条
    expect(engine.getSnapshot().events.some((e) => e.includes('群游'))).toBe(true);
  });

  it('未养水时买鱼被拦截，养水完成后硝化建立且可放鱼', () => {
    const engine = createEngine();
    expect(engine.buyFish('guppy').ok).toBe(false);
    expect(engine.startCycling().ok).toBe(true);
    expect(engine.startCycling().ok).toBe(false); // 重复养水被拒
    engine.fastForward(60 * 60 * 2);
    expect(engine.getPersistedState(Date.now()).nitrogenEstablished).toBe(true);
    expect(engine.buyFish('guppy').ok).toBe(true);
  });

  it('养水后细菌在空缸期休眠保留，不衰减归零', () => {
    const engine = cycledEngine();
    engine.fastForward(60 * 60 * 24); // 空缸再等 1 游戏天
    const w = engine.getSnapshot().water;
    expect(w.b1).toBeGreaterThan(5);
    expect(w.b2).toBeGreaterThan(5);
  });

  it('completeGuide 后引导状态持久化', () => {
    const engine = createEngine();
    engine.completeGuide();
    expect(engine.getPersistedState(Date.now()).guideDone).toBe(true);
  });

  it('长时推演 7 游戏天，数值保持有界且无异常', () => {
    const engine = cycledEngine();
    engine.buyFish('guppy');
    engine.fastForward(60 * 60 * 24 * 7);
    const snap = engine.getSnapshot();
    expect(snap.water.nh3).toBeGreaterThanOrEqual(0);
    expect(snap.water.nh3).toBeLessThanOrEqual(10);
    expect(snap.water.no3).toBeLessThanOrEqual(100);
    expect(Number.isFinite(snap.water.b1)).toBe(true);
  }, 20000);
});

describe('鱼寿命系统', () => {
  it('年龄随推演按 tick 累积', () => {
    const engine = cycledEngine();
    engine.buyFish('guppy');
    engine.advance(5); // 300 个 tick
    expect(engine.getSnapshot().fishes[0].age).toBe(300);
  });

  it('达到寿命时寿终正寝并温和移除，而非疾病死亡', () => {
    const engine = cycledEngine();
    engine.buyFish('guppy');
    const lifespan = FISH_CATALOG.find((f) => f.id === 'guppy')!.lifespan;
    // 构造一条已接近寿命的鱼，避免跑完整寿命
    const state = engine.getPersistedState(Date.now());
    state.fishes[0].age = lifespan - 100;
    const aged = createEngine(state);

    const result = aged.fastForward(200); // 跨过寿命
    expect(aged.getSnapshot().fishes).toHaveLength(0);
    expect(result.events.some((e) => e.includes('寿终正寝'))).toBe(true);
  });
});
