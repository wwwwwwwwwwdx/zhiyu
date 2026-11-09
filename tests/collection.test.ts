import { describe, it, expect } from 'vitest';
import { createEmptyCollection, reconcileCollection, collectionCounts } from '../src/engine/progression/collection';
import { COMMON_VARIANT } from '../src/engine/biology/variants';
import type { FishState, PlantState } from '../src/engine/core/types';

function makeFish(over: Partial<FishState>): FishState {
  return {
    id: 'f', specId: 'guppy', name: '孔雀鱼', age: 0, hunger: 0, stress: 0,
    health: 100, weight: 3, behavior: 'normal', breedCooldown: 0, variant: COMMON_VARIANT,
    ...over,
  };
}

describe('图鉴发现', () => {
  it('空图鉴初始无发现', () => {
    expect(collectionCounts(createEmptyCollection())).toEqual({ fish: 0, variants: 0, plants: 0 });
  });

  it('缸内鱼和水草被点亮', () => {
    const fishes = [makeFish({ specId: 'guppy' })];
    const plants: PlantState[] = [{ id: 'p', specId: 'plant-moss', size: 0.2, health: 100 }];
    const out = reconcileCollection(createEmptyCollection(), fishes, plants);
    expect(out.fish).toContain('guppy');
    expect(out.plants).toContain('plant-moss');
  });

  it('稀有品系单独点亮', () => {
    const fishes = [makeFish({ specId: 'guppy', variant: 'guppy-albino' })];
    const out = reconcileCollection(createEmptyCollection(), fishes, []);
    expect(out.variants).toContain('guppy-albino');
  });

  it('普通品系不进入稀有集合', () => {
    const out = reconcileCollection(createEmptyCollection(), [makeFish({})], []);
    expect(out.variants).toHaveLength(0);
  });

  it('发现只增不减：鱼离开后历史发现保留', () => {
    const first = reconcileCollection(createEmptyCollection(), [makeFish({ specId: 'neon' })], []);
    const after = reconcileCollection(first, [], []);
    expect(after.fish).toContain('neon');
  });
});
