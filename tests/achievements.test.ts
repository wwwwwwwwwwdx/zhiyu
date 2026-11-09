import { describe, it, expect } from 'vitest';
import { evaluateAchievements, ACHIEVEMENT_CATALOG } from '../src/engine/progression/achievements';
import { GAME_DAY } from '../src/engine/balance/constants';
import type { CollectionState } from '../src/engine/core/types';

const emptyCollection: CollectionState = { fish: [], variants: [], plants: [] };

const baseCtx = {
  fishCount: 0, plantCount: 0, nitrogenEstablished: false,
  collection: emptyCollection, gameTime: 0, coins: 0,
};

describe('成就判定', () => {
  it('无任何进展时不解锁', () => {
    expect(evaluateAchievements(baseCtx, [])).toHaveLength(0);
  });

  it('拥有第一条鱼解锁初次相遇', () => {
    const out = evaluateAchievements({ ...baseCtx, fishCount: 1 }, []);
    expect(out).toContain('first-fish');
  });

  it('硝化建立解锁水到渠成', () => {
    const out = evaluateAchievements({ ...baseCtx, nitrogenEstablished: true }, []);
    expect(out).toContain('water-ready');
  });

  it('稀有品系点亮后解锁意外之喜', () => {
    const collection: CollectionState = { ...emptyCollection, variants: ['guppy-albino'] };
    const out = evaluateAchievements({ ...baseCtx, collection }, []);
    expect(out).toContain('rare-fish');
  });

  it('陪伴 30 游戏日解锁长久陪伴', () => {
    const out = evaluateAchievements({ ...baseCtx, gameTime: 30 * GAME_DAY }, []);
    expect(out).toContain('long-companion');
  });

  it('已解锁的成就不重复返回', () => {
    const out = evaluateAchievements({ ...baseCtx, fishCount: 1 }, ['first-fish']);
    expect(out).not.toContain('first-fish');
  });

  it('成就目录条目都有名称与描述', () => {
    for (const def of ACHIEVEMENT_CATALOG) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });
});
