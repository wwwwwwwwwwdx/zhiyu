// 图鉴纯函数：根据缸内实际存在的鱼和植物同步发现记录，幂等、只增不减。
// 位置为引擎层，零 DOM 依赖，可独立单测。

import type { CollectionState, FishState, PlantState } from '../core/types';
import { COMMON_VARIANT } from '../biology/variants';

export function createEmptyCollection(): CollectionState {
  return { fish: [], variants: [], plants: [] };
}

//  reconcile：无论鱼怎么来的（购买、繁殖、存档恢复），只要在缸内就点亮对应条目
export function reconcileCollection(
  collection: CollectionState,
  fishes: FishState[],
  plants: PlantState[],
): CollectionState {
  const fishSet = new Set(collection.fish);
  const variantSet = new Set(collection.variants);
  const plantSet = new Set(collection.plants);
  for (const f of fishes) {
    fishSet.add(f.specId);
    if (f.variant !== COMMON_VARIANT) variantSet.add(f.variant);
  }
  for (const p of plants) plantSet.add(p.specId);
  return {
    fish: [...fishSet].sort(),
    variants: [...variantSet].sort(),
    plants: [...plantSet].sort(),
  };
}

export function collectionCounts(collection: CollectionState): {
  fish: number; variants: number; plants: number;
} {
  return {
    fish: collection.fish.length,
    variants: collection.variants.length,
    plants: collection.plants.length,
  };
}
