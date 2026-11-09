import { describe, it, expect } from 'vitest';
import { migratePersistedState } from '../src/persistence/migrate';
import { createEngine } from '../src/engine/engine';
import { CURRENT_SAVE_VERSION, type PersistedState } from '../src/engine/core/types';

describe('存档迁移', () => {
  it('当前版本存档原样返回', () => {
    const state: PersistedState = {
      version: CURRENT_SAVE_VERSION, savedAt: Date.now(), gameTime: 0, coins: 0,
      water: { nh3: 0, no2: 0, no3: 0, b1: 0, b2: 0, o2: 0, co2: 0, algae: 0, ph: 7, temp: 22 },
      fishes: [], plants: [], ownedEquipment: [],
      installed: { filter: null, light: null, heater: null, co2: null },
      lightOn: true, heaterTarget: 25, nitrogenEstablished: false,
      cycling: false, guideDone: false, fishSeq: 0, plantSeq: 0,
      environment: 'desk', tankShape: 'rectangle',
      collection: { fish: [], variants: [], plants: [] },
      achievement: { unlocked: [] },
      lastDailyRewardDay: 0,
      monthlyPass: { expireGameTime: 0, lastClaimDay: 0 },
    };
    expect(migratePersistedState(state)).toBe(state);
  });

  it('引擎写入的存档版本等于权威常量，保证单一来源', () => {
    const engine = createEngine();
    expect(engine.getPersistedState(Date.now()).version).toBe(CURRENT_SAVE_VERSION);
  });

  it('v3 存档经 v4、v5、v6 迁移到当前版本，补 age、breedCooldown、variant 并保留旧字段', () => {
    const v3 = {
      version: 3, savedAt: Date.now(), gameTime: 60, coins: 200,
      water: { nh3: 0.1, no2: 0.2, no3: 5, b1: 6, b2: 6, o2: 7, co2: 0.4, algae: 0, ph: 6.8, temp: 25 },
      fishes: [{ id: 'guppy-1', specId: 'guppy', name: '孔雀鱼', hunger: 10, stress: 0, health: 100, weight: 2, behavior: 'normal' }],
      plants: [], ownedEquipment: ['filter-wall'],
      installed: { filter: 'filter-wall', light: 'light-led', heater: 'heater-50', co2: null },
      lightOn: true, heaterTarget: 25, nitrogenEstablished: true,
      cycling: false, guideDone: true, fishSeq: 1, plantSeq: 0,
    } as unknown as PersistedState;

    const out = migratePersistedState(v3);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.fishes[0].age).toBe(0);
    expect(out.fishes[0].breedCooldown).toBe(0);
    expect(out.fishes[0].variant).toBe('common');
    expect(out.fishes[0].name).toBe('孔雀鱼'); // 旧字段保留
  });

  it('v4 存档迁移到当前版本，补 breedCooldown 与 variant', () => {
    const v4 = {
      version: 4, savedAt: Date.now(), gameTime: 60, coins: 200,
      water: { nh3: 0.1, no2: 0.2, no3: 5, b1: 6, b2: 6, o2: 7, co2: 0.4, algae: 0, ph: 6.8, temp: 25 },
      fishes: [{ id: 'guppy-1', specId: 'guppy', name: '孔雀鱼', age: 100, hunger: 10, stress: 0, health: 100, weight: 2, behavior: 'normal' }],
      plants: [], ownedEquipment: ['filter-wall'],
      installed: { filter: 'filter-wall', light: 'light-led', heater: 'heater-50', co2: null },
      lightOn: true, heaterTarget: 25, nitrogenEstablished: true,
      cycling: false, guideDone: true, fishSeq: 1, plantSeq: 0,
    } as unknown as PersistedState;

    const out = migratePersistedState(v4);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.fishes[0].breedCooldown).toBe(0);
    expect(out.fishes[0].variant).toBe('common');
    expect(out.fishes[0].age).toBe(100); // 旧字段保留
  });

  it('v5 存档经 v6、v7、v8 迁移到当前版本，补 variant、environment 与 tankShape', () => {
    const v5 = {
      version: 5, savedAt: Date.now(), gameTime: 60, coins: 200,
      water: { nh3: 0.1, no2: 0.2, no3: 5, b1: 6, b2: 6, o2: 7, co2: 0.4, algae: 0, ph: 6.8, temp: 25 },
      fishes: [{ id: 'guppy-1', specId: 'guppy', name: '孔雀鱼', age: 100, hunger: 10, stress: 0, health: 100, weight: 2, behavior: 'normal', breedCooldown: 0 }],
      plants: [], ownedEquipment: ['filter-wall'],
      installed: { filter: 'filter-wall', light: 'light-led', heater: 'heater-50', co2: null },
      lightOn: true, heaterTarget: 25, nitrogenEstablished: true,
      cycling: false, guideDone: true, fishSeq: 1, plantSeq: 0,
    } as unknown as PersistedState;

    const out = migratePersistedState(v5);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.fishes[0].variant).toBe('common');
    expect(out.environment).toBe('desk');
    expect(out.tankShape).toBe('rectangle');
    expect(out.fishes[0].breedCooldown).toBe(0); // 旧字段保留
  });

  it('v6 存档经 v7、v8 迁移，补环境与形状', () => {
    const v6 = {
      version: 6, savedAt: Date.now(), gameTime: 60, coins: 200,
      water: { nh3: 0.1, no2: 0.2, no3: 5, b1: 6, b2: 6, o2: 7, co2: 0.4, algae: 0, ph: 6.8, temp: 25 },
      fishes: [], plants: [], ownedEquipment: [],
      installed: { filter: null, light: null, heater: null, co2: null },
      lightOn: true, heaterTarget: 25, nitrogenEstablished: true,
      cycling: false, guideDone: true, fishSeq: 1, plantSeq: 0,
    } as unknown as PersistedState;

    const out = migratePersistedState(v6);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.environment).toBe('desk');
    expect(out.tankShape).toBe('rectangle');
  });

  it('v7 存档经 v8、v9 迁移，补形状与图鉴成就', () => {
    const v7 = {
      version: 7, savedAt: Date.now(), gameTime: 60, coins: 200,
      water: { nh3: 0.1, no2: 0.2, no3: 5, b1: 6, b2: 6, o7: 7, co2: 0.4, algae: 0, ph: 6.8, temp: 25 },
      fishes: [], plants: [], ownedEquipment: [],
      installed: { filter: null, light: null, heater: null, co2: null },
      lightOn: true, heaterTarget: 25, nitrogenEstablished: true,
      cycling: false, guideDone: true, fishSeq: 1, plantSeq: 0,
      environment: 'desk',
    } as unknown as PersistedState;

    const out = migratePersistedState(v7);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.tankShape).toBe('rectangle');
    expect(out.collection).toEqual({ fish: [], variants: [], plants: [] });
    expect(out.achievement).toEqual({ unlocked: [] });
    expect(out.lastDailyRewardDay).toBe(0);
    expect(out.monthlyPass).toEqual({ expireGameTime: 0, lastClaimDay: 0 });
  });

  it('v8 存档经 v9、v10 迁移，补图鉴成就与付费字段', () => {
    const v8 = {
      version: 8, savedAt: Date.now(), gameTime: 60, coins: 200,
      water: { nh3: 0.1, no2: 0.2, no3: 5, b1: 6, b2: 6, o2: 7, co2: 0.4, algae: 0, ph: 6.8, temp: 25 },
      fishes: [], plants: [], ownedEquipment: [],
      installed: { filter: null, light: null, heater: null, co2: null },
      lightOn: true, heaterTarget: 25, nitrogenEstablished: true,
      cycling: false, guideDone: true, fishSeq: 1, plantSeq: 0,
      environment: 'desk', tankShape: 'rectangle',
    } as unknown as PersistedState;

    const out = migratePersistedState(v8);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.collection).toEqual({ fish: [], variants: [], plants: [] });
    expect(out.achievement.unlocked).toEqual([]);
    expect(out.lastDailyRewardDay).toBe(0);
    expect(out.monthlyPass).toEqual({ expireGameTime: 0, lastClaimDay: 0 });
  });

  it('v9 存档迁移到 v10：补每日奖励与月卡状态', () => {
    const v9 = {
      version: 9, savedAt: Date.now(), gameTime: 60, coins: 200,
      water: { nh3: 0.1, no2: 0.2, no3: 5, b1: 6, b2: 6, o2: 7, co2: 0.4, algae: 0, ph: 6.8, temp: 25 },
      fishes: [], plants: [], ownedEquipment: [],
      installed: { filter: null, light: null, heater: null, co2: null },
      lightOn: true, heaterTarget: 25, nitrogenEstablished: true,
      cycling: false, guideDone: true, fishSeq: 1, plantSeq: 0,
      environment: 'desk', tankShape: 'rectangle',
      collection: { fish: [], variants: [], plants: [] },
      achievement: { unlocked: [] },
    } as unknown as PersistedState;

    const out = migratePersistedState(v9);
    expect(out.version).toBe(10);
    expect(out.lastDailyRewardDay).toBe(0);
    expect(out.monthlyPass).toEqual({ expireGameTime: 0, lastClaimDay: 0 });
  });

  it('v1 存档逐级迁移到当前版本，默认值齐全且旧数据保留', () => {
    const v1 = {
      version: 1, savedAt: Date.now(), gameTime: 120, coins: 300,
      water: { nh3: 0.1, no2: 0.2, no3: 5, b1: 6, b2: 6, o2: 7, ph: 7, temp: 25 },
      fishes: [], ownedEquipment: ['filter-wall'],
      installed: { filter: 'filter-wall', light: 'light-led', heater: 'heater-50' },
      lightOn: true, heaterTarget: 25, nitrogenEstablished: true,
      cycling: false, guideDone: true, fishSeq: 0,
    } as unknown as PersistedState;

    const migrated = migratePersistedState(v1);
    expect(migrated.version).toBe(CURRENT_SAVE_VERSION);
    expect(migrated.water.co2).toBe(0);
    expect(migrated.water.algae).toBe(0);
    expect(migrated.plants).toEqual([]);
    expect(migrated.installed.co2).toBeNull();
    expect(migrated.plantSeq).toBe(0);
    // 旧字段原样保留
    expect(migrated.coins).toBe(300);
    expect(migrated.water.nh3).toBe(0.1);
    expect(migrated.installed.filter).toBe('filter-wall');
    expect(migrated.environment).toBe('desk');
    expect(migrated.tankShape).toBe('rectangle');
    expect(migrated.collection).toEqual({ fish: [], variants: [], plants: [] });
    expect(migrated.achievement.unlocked).toEqual([]);
    expect(migrated.lastDailyRewardDay).toBe(0);
    expect(migrated.monthlyPass).toEqual({ expireGameTime: 0, lastClaimDay: 0 });
  });
});
