// 繁殖逻辑（纯函数）：性成熟、健康低压力、同种群体、冷却与缸容量共同决定自然繁殖，
// 并在产仔时按变异/遗传决定幼鱼品系。零 DOM、零渲染依赖，由 engine tick 调用。
import type { FishSpec, FishState } from '../core/types';
import { rollOffspringVariant, getRareVariant } from './variants';

export interface BreedingInput {
  fishes: FishState[];
  findSpec: (specId: string) => FishSpec | undefined;
  makeId: (specId: string) => string;
  capacityGrams: number;
  dt: number;
  rand: () => number;
}

export interface BreedingResult {
  events: string[];
}

// 一条鱼是否为可参与繁殖的健康成鱼
function isReadyBreeder(fish: FishState, spec: FishSpec): boolean {
  return (
    fish.age >= spec.lifespan * spec.matureRatio &&
    fish.breedCooldown <= 0 &&
    fish.health >= 70 &&
    fish.stress <= 30 &&
    fish.hunger <= 50
  );
}

export function stepBreeding(input: BreedingInput): BreedingResult {
  const { fishes, findSpec, makeId, capacityGrams, dt, rand } = input;
  const events: string[] = [];

  // 繁殖冷却逐 tick 递减
  for (const fish of fishes) {
    if (fish.breedCooldown > 0) fish.breedCooldown = Math.max(0, fish.breedCooldown - dt);
  }

  // 按鱼种分组
  const groups = new Map<string, FishState[]>();
  for (const fish of fishes) {
    const list = groups.get(fish.specId) ?? [];
    list.push(fish);
    groups.set(fish.specId, list);
  }

  for (const [specId, group] of groups) {
    const spec = findSpec(specId);
    if (!spec) continue;
    const ready = group.filter((f) => isReadyBreeder(f, spec));
    // 至少需要两条性成熟且状态良好的亲本
    if (ready.length < 2) continue;

    // 缸容量余量决定实际可产下的幼鱼数
    const currentWeight = fishes.reduce((sum, f) => sum + f.weight, 0);
    const babyWeight = spec.adultWeight * 0.3;
    const room = Math.floor((capacityGrams - currentWeight) / babyWeight);
    if (room <= 0) continue;

    const count = Math.min(spec.broodSize, room);
    // 参与的成鱼进入繁殖冷却，避免连续繁殖
    for (const breeder of ready) breeder.breedCooldown = spec.breedInterval;

    let rareCount = 0;
    for (let i = 0; i < count; i++) {
      // 亲本为参与繁殖的成鱼，据此判定遗传或随机变异
      const variant = rollOffspringVariant({
        specId: spec.id,
        parentVariants: ready.map((f) => f.variant),
        rand,
      });
      if (variant !== 'common') rareCount += 1;
      fishes.push({
        id: makeId(spec.id),
        specId: spec.id,
        name: spec.name,
        age: 0,
        hunger: 20,
        stress: 0,
        health: 100,
        weight: babyWeight,
        behavior: 'normal',
        breedCooldown: 0, // 幼鱼靠成熟年龄控制，未成熟不会繁殖
        variant,
      });
    }
    events.push(`新生命：${count} 条小${spec.name}诞生了`);
    // 稀有品系单独给一条惊喜事件
    if (rareCount > 0) {
      const rareNames = [...new Set(
        fishes.slice(fishes.length - count)
          .filter((f) => f.variant !== 'common')
          .map((f) => getRareVariant(spec.id, f.variant)?.name),
      )].filter(Boolean);
      events.push(`惊喜：诞生了稀有品系——${rareNames.join('、')}`);
    }
  }

  return { events };
}
