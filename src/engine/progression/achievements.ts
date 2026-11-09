// 成就纯函数：里程碑式纪念，只记录已发生的事。
// 判定全部基于当前可观测状态与图鉴（图鉴只增不减），不依赖瞬时事件，可独立单测。

import { GAME_DAY } from '../balance/constants';
import type { CollectionState } from '../core/types';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  rewardCoins: number; // 达成时发放的金币奖励
}

export const ACHIEVEMENT_CATALOG: AchievementDef[] = [
  { id: 'first-fish', name: '初次相遇', description: '拥有第一条鱼', rewardCoins: 20 },
  { id: 'water-ready', name: '水到渠成', description: '硝化系统建立完成', rewardCoins: 20 },
  { id: 'first-plant', name: '绿意初现', description: '种下第一株水草', rewardCoins: 20 },
  { id: 'school', name: '成群结队', description: '同时拥有 6 条鱼', rewardCoins: 50 },
  { id: 'rare-fish', name: '意外之喜', description: '获得一条稀有品系', rewardCoins: 50 },
  { id: 'long-companion', name: '长久陪伴', description: '陪伴走过 30 个游戏日', rewardCoins: 100 },
  { id: 'collector', name: '博物君子', description: '集齐全部 8 种基础鱼', rewardCoins: 100 },
  { id: 'wealthy', name: '小有积蓄', description: '拥有 1000 金币', rewardCoins: 50 },
];

export interface AchievementContext {
  fishCount: number;
  plantCount: number;
  nitrogenEstablished: boolean;
  collection: CollectionState;
  gameTime: number;
  coins: number;
}

function conditions(ctx: AchievementContext): Record<string, boolean> {
  return {
    'first-fish': ctx.fishCount >= 1,
    'water-ready': ctx.nitrogenEstablished,
    'first-plant': ctx.plantCount >= 1,
    school: ctx.fishCount >= 6,
    'rare-fish': ctx.collection.variants.length >= 1,
    'long-companion': ctx.gameTime >= 30 * GAME_DAY,
    collector: ctx.collection.fish.length >= 8,
    wealthy: ctx.coins >= 1000,
  };
}

// 返回本次新达成的成就 id（已解锁的不再重复返回）
export function evaluateAchievements(
  ctx: AchievementContext,
  alreadyUnlocked: string[],
): string[] {
  const unlockedSet = new Set(alreadyUnlocked);
  const result = conditions(ctx);
  return ACHIEVEMENT_CATALOG
    .filter((def) => result[def.id] && !unlockedSet.has(def.id))
    .map((def) => def.id);
}

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENT_CATALOG.find((a) => a.id === id);
}
