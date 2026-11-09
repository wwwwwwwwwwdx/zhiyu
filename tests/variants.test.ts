import { describe, it, expect } from 'vitest';
import {
  rollOffspringVariant, getRareVariants, getRareVariant, resolveVariantName, COMMON_VARIANT,
} from '../src/engine/biology/variants';

describe('稀有品系判定', () => {
  it('普通亲本在高 rand 下产出普通品系', () => {
    const variant = rollOffspringVariant({
      specId: 'guppy', parentVariants: [COMMON_VARIANT, COMMON_VARIANT], rand: () => 0.99,
    });
    expect(variant).toBe(COMMON_VARIANT);
  });

  it('普通亲本在低 rand 下随机变异出稀有品系', () => {
    const variant = rollOffspringVariant({
      specId: 'guppy', parentVariants: [COMMON_VARIANT, COMMON_VARIANT], rand: () => 0,
    });
    expect(variant).toBe('guppy-albino');
  });

  it('稀有亲本在低 rand 下遗传其品系', () => {
    const variant = rollOffspringVariant({
      specId: 'guppy', parentVariants: ['guppy-albino', COMMON_VARIANT], rand: () => 0,
    });
    expect(variant).toBe('guppy-albino');
  });

  it('稀有亲本未命中遗传且未变异时回退为普通', () => {
    const variant = rollOffspringVariant({
      specId: 'guppy', parentVariants: ['guppy-albino', COMMON_VARIANT], rand: () => 0.9,
    });
    expect(variant).toBe(COMMON_VARIANT);
  });

  it('可按鱼种查询其稀有品系与配置', () => {
    expect(getRareVariants('guppy').length).toBe(2);
    expect(getRareVariant('angelfish', 'angelfish-gold')?.name).toBe('金色神仙鱼');
  });

  it('resolveVariantName 普通回退基础名、稀有返回品系名', () => {
    expect(resolveVariantName('guppy', COMMON_VARIANT, '孔雀鱼')).toBe('孔雀鱼');
    expect(resolveVariantName('molly', 'molly-black', '玛丽鱼')).toBe('黑玛丽鱼');
  });
});
