import { CURRENT_SAVE_VERSION, type PersistedState } from '../engine/core/types';

// 迁移函数表：key 为"源版本"，函数负责升级到下一版本
const migrations: Record<number, (state: PersistedState) => PersistedState> = {
  // v1 -> v2：引入溶解 CO2、水草与 CO2 设备，为旧存档补默认值
  1: (state) => {
    const legacy = state as unknown as {
      water: Record<string, unknown>;
      installed: Record<string, unknown>;
    };
    return {
      ...(state as object),
      version: 2,
      water: { ...legacy.water, co2: 0 },
      plants: [],
      installed: { ...legacy.installed, co2: null },
      plantSeq: 0,
    } as unknown as PersistedState;
  },

  // v2 -> v3：引入藻类字段，为旧存档补默认值
  2: (state) => {
    const legacy = state as unknown as { water: Record<string, unknown> };
    return {
      ...(state as object),
      version: 3,
      water: { ...legacy.water, algae: 0 },
    } as unknown as PersistedState;
  },

  // v3 -> v4：引入鱼年龄，为已有鱼补 age=0
  3: (state) => {
    const legacy = state as unknown as { fishes: Array<Record<string, unknown>> };
    return {
      ...(state as object),
      version: 4,
      fishes: legacy.fishes.map((f) => ({ ...f, age: 0 })),
    } as unknown as PersistedState;
  },

  // v4 -> v5：引入鱼繁殖冷却，为已有鱼补 breedCooldown=0
  4: (state) => {
    const legacy = state as unknown as { fishes: Array<Record<string, unknown>> };
    return {
      ...(state as object),
      version: 5,
      fishes: legacy.fishes.map((f) => ({ ...f, breedCooldown: 0 })),
    } as unknown as PersistedState;
  },

  // v5 -> v6：引入鱼品系，为已有鱼补 variant='common'
  5: (state) => {
    const legacy = state as unknown as { fishes: Array<Record<string, unknown>> };
    return {
      ...(state as object),
      version: 6,
      fishes: legacy.fishes.map((f) => ({ ...f, variant: 'common' })),
    } as unknown as PersistedState;
  },

  // v6 -> v7：引入放置环境，补默认书房桌面
  6: (state) => {
    return {
      ...(state as object),
      version: 7,
      environment: 'desk',
    } as unknown as PersistedState;
  },

  // v7 -> v8：引入鱼缸形状，补默认长方缸
  7: (state) => {
    return {
      ...(state as object),
      version: 8,
      tankShape: 'rectangle',
    } as unknown as PersistedState;
  },

  // v8 -> v9：引入图鉴与成就，补空记录
  8: (state) => {
    return {
      ...(state as object),
      version: 9,
      collection: { fish: [], variants: [], plants: [] },
      achievement: { unlocked: [] },
    } as unknown as PersistedState;
  },

  // v9 -> v10：引入付费点，补每日奖励与月卡状态
  9: (state) => {
    return {
      ...(state as object),
      version: 10,
      lastDailyRewardDay: 0,
      monthlyPass: { expireGameTime: 0, lastClaimDay: 0 },
    } as unknown as PersistedState;
  },
};

// 存档结构校验：只校验恢复引擎所必需的最小字段，旧版本缺字段交给迁移补齐，
// 避免把合法旧档误判为损坏。用于 IndexedDB 读取后的第一道防线。
export function isPersistedState(value: unknown): value is PersistedState {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  const w = s.water;
  if (typeof w !== 'object' || w === null) return false;
  const water = w as Record<string, unknown>;
  const waterKeys = ['nh3', 'no2', 'no3', 'b1', 'b2', 'o2', 'ph', 'temp'];
  return typeof s.version === 'number' && Number.isInteger(s.version) && s.version >= 1
    && typeof s.savedAt === 'number' && Number.isFinite(s.savedAt)
    && typeof s.gameTime === 'number' && Number.isFinite(s.gameTime)
    && typeof s.coins === 'number' && Number.isFinite(s.coins)
    && waterKeys.every((k) => typeof water[k] === 'number' && Number.isFinite(water[k] as number))
    && Array.isArray(s.fishes)
    && Array.isArray(s.ownedEquipment)
    && typeof s.installed === 'object' && s.installed !== null;
}

// 加载存档后逐版本迁移到当前版本；缺失迁移路径时快速失败，避免静默使用脏数据
export function migratePersistedState(state: PersistedState): PersistedState {
  if (!Number.isInteger(state.version) || state.version < 1) {
    throw new Error('存档版本号无效');
  }
  if (state.version > CURRENT_SAVE_VERSION) {
    throw new Error(`存档版本 v${state.version} 高于当前程序支持的 v${CURRENT_SAVE_VERSION}，请升级后重试`);
  }
  let current = state;
  while (current.version < CURRENT_SAVE_VERSION) {
    const migrate = migrations[current.version];
    if (!migrate) {
      throw new Error(`缺少 v${current.version} 的存档迁移路径`);
    }
    current = migrate(current);
  }
  return current;
}
