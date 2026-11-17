import { describe, it, expect } from 'vitest';
import { FISH_CATALOG } from '../src/engine/balance/catalog';
import { FISH_MOTION_CONFIG } from '../src/render/fishMotion';
import { RARE_VARIANT_CATALOG } from '../src/engine/biology/variants';
import { ACHIEVEMENT_CATALOG, evaluateAchievements, getAchievement } from '../src/engine/progression/achievements';
import { LIMITED_CARDS } from '../src/engine/balance/cardTiers';
import { QUALITY_PRESET, tierFromFps } from '../src/render/PerformanceMonitor';
import type { CollectionState } from '../src/engine/core/types';

const emptyCollection: CollectionState = { fish: [], variants: [], plants: [] };
const baseCtx = {
  fishCount: 0, plantCount: 0, nitrogenEstablished: false,
  collection: emptyCollection, gameTime: 0, coins: 0,
};

describe('目录与配置一致性', () => {
  it('鱼类目录中每种鱼都有专属游动配置', () => {
    for (const spec of FISH_CATALOG) {
      expect(FISH_MOTION_CONFIG[spec.id], `缺少游动配置：${spec.id}`).toBeDefined();
    }
  });

  it('鱼类目录中每种鱼至少有一个稀有品系', () => {
    for (const spec of FISH_CATALOG) {
      expect(RARE_VARIANT_CATALOG.some((v) => v.baseSpecId === spec.id), `缺少稀有品系：${spec.id}`).toBe(true);
    }
  });

  it('集齐成就的阈值与文案跟随鱼类目录', () => {
    const all: CollectionState = { ...emptyCollection, fish: FISH_CATALOG.map((f) => f.id) };
    expect(evaluateAchievements({ ...baseCtx, collection: all }, [])).toContain('collector');
    const almost: CollectionState = { ...emptyCollection, fish: FISH_CATALOG.slice(0, -1).map((f) => f.id) };
    expect(evaluateAchievements({ ...baseCtx, collection: almost }, [])).not.toContain('collector');
    expect(getAchievement('collector')?.description).toContain(String(FISH_CATALOG.length));
  });

  it('限定卡白名单非空且成员有效', () => {
    expect(LIMITED_CARDS.size).toBeGreaterThan(0);
    const known = new Set([
      ...FISH_CATALOG.map((f) => f.id),
      ...RARE_VARIANT_CATALOG.map((v) => v.id),
    ]);
    for (const id of LIMITED_CARDS) expect(known.has(id)).toBe(true);
  });

  it('成就目录条目都有名称与描述', () => {
    for (const def of ACHIEVEMENT_CATALOG) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('画质三档的重开销参数逐级递减', () => {
    const { high, medium, low } = QUALITY_PRESET;
    expect(high.bubbles).toBeGreaterThan(medium.bubbles);
    expect(medium.bubbles).toBeGreaterThan(low.bubbles);
    expect(high.particles).toBeGreaterThan(medium.particles);
    expect(medium.particles).toBeGreaterThan(low.particles);
  });

  it('高帧可逐档升回，中档区间保持不变', () => {
    expect(tierFromFps(58, 'low')).toBe('medium');
    expect(tierFromFps(58, 'medium')).toBe('high');
    expect(tierFromFps(40, 'low')).toBe('low');
  });
});
