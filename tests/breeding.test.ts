import { describe, it, expect } from 'vitest';
import { stepBreeding } from '../src/engine/biology/breeding';
import { COMMON_VARIANT } from '../src/engine/biology/variants';
import { FISH_CATALOG } from '../src/engine/balance/catalog';
import type { FishState } from '../src/engine/core/types';

const spec = FISH_CATALOG.find((f) => f.id === 'guppy')!;
let seq = 0;

function makeFish(overrides: Partial<FishState> = {}): FishState {
  return {
    id: `guppy-${Math.random()}`,
    specId: 'guppy',
    name: '孔雀鱼',
    age: spec.lifespan, // 默认已成熟
    hunger: 10,
    stress: 0,
    health: 100,
    weight: spec.adultWeight,
    behavior: 'normal',
    breedCooldown: 0,
    variant: COMMON_VARIANT,
    ...overrides,
  };
}

// 固定高 rand，不触发变异/遗传，保证普通繁殖断言稳定
function runOnce(fishes: FishState[], capacityGrams = 60, rand: () => number = () => 0.99) {
  return stepBreeding({
    fishes,
    findSpec: (id) => FISH_CATALOG.find((f) => f.id === id),
    makeId: (id) => { seq += 1; return `${id}-${seq}`; },
    capacityGrams,
    dt: 1,
    rand,
  });
}

describe('繁殖系统', () => {
  it('两条成熟健康的同种鱼会繁殖，数量增加并产生事件', () => {
    const fishes = [makeFish(), makeFish()];
    const result = runOnce(fishes);
    expect(fishes.length).toBe(2 + spec.broodSize);
    expect(result.events.length).toBe(1);
    const babies = fishes.slice(2);
    expect(babies.every((b) => b.age === 0)).toBe(true);
  });

  it('未成熟的鱼不繁殖', () => {
    const fishes = [makeFish({ age: 0 }), makeFish({ age: 0 })];
    runOnce(fishes);
    expect(fishes.length).toBe(2);
  });

  it('繁殖后成鱼进入冷却，下一步不重复繁殖', () => {
    const fishes = [makeFish(), makeFish()];
    runOnce(fishes);
    const countAfterFirst = fishes.length;
    runOnce(fishes);
    expect(fishes.length).toBe(countAfterFirst);
  });

  it('健康不足或压力过高时不繁殖', () => {
    const fishes = [makeFish({ health: 50 }), makeFish({ stress: 80 })];
    runOnce(fishes);
    expect(fishes.length).toBe(2);
  });

  it('单条鱼不繁殖，需要至少两个亲本', () => {
    const fishes = [makeFish()];
    runOnce(fishes);
    expect(fishes.length).toBe(1);
  });

  it('缸容量满时不繁殖', () => {
    const fishes = [makeFish(), makeFish()];
    runOnce(fishes, spec.adultWeight * 2);
    expect(fishes.length).toBe(2);
  });

  it('随机变异命中时幼鱼为稀有品系并给出惊喜事件', () => {
    const fishes = [makeFish(), makeFish()];
    const result = runOnce(fishes, 60, () => 0); // rand 0 命中首个稀有品系
    const babies = fishes.slice(2);
    expect(babies.every((b) => b.variant === 'guppy-albino')).toBe(true);
    expect(result.events.some((e) => e.includes('稀有品系'))).toBe(true);
  });
});
