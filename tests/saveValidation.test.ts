import { describe, it, expect } from 'vitest';
import { isPersistedState, migratePersistedState } from '../src/persistence/migrate';
import { backupCorruptedSave } from '../src/persistence/saveRepository';
import { createEngine } from '../src/engine/engine';
import { CURRENT_SAVE_VERSION } from '../src/engine/core/types';

const valid = () => createEngine().getPersistedState(Date.now());

describe('存档健壮性', () => {
  it('引擎写出的存档通过结构校验', () => {
    expect(isPersistedState(valid())).toBe(true);
  });

  it('缺关键字段或字段类型错误被判为损坏', () => {
    expect(isPersistedState(null)).toBe(false);
    expect(isPersistedState({})).toBe(false);
    expect(isPersistedState({ ...valid(), water: { ...valid().water, nh3: 'x' } })).toBe(false);
    expect(isPersistedState({ ...valid(), fishes: null })).toBe(false);
    expect(isPersistedState({ ...valid(), installed: null })).toBe(false);
  });

  it('旧版本存档缺少后续字段仍通过最小校验，交给迁移补齐', () => {
    const legacy = { ...valid(), version: 1 } as Record<string, unknown>;
    delete legacy.plants;
    delete legacy.collection;
    delete legacy.monthlyPass;
    expect(isPersistedState(legacy)).toBe(true);
  });

  it('版本高于当前程序时明确拒绝迁移，不使用脏数据', () => {
    expect(() => migratePersistedState({ ...valid(), version: CURRENT_SAVE_VERSION + 1 }))
      .toThrow(/高于当前程序/);
  });

  it('非法版本号明确拒绝迁移', () => {
    expect(() => migratePersistedState({ ...valid(), version: 0 })).toThrow(/版本号无效/);
  });

  it('无 localStorage 时备份失败不抛错', () => {
    expect(backupCorruptedSave({ broken: true })).toBe(false);
  });
});
