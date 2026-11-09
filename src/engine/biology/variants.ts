// 稀有品系（纯函数，零 DOM）：同一鱼种的稀有品系通过繁殖中的低概率变异产生，
// 也可由稀有亲本以较高概率遗传。不做任务解锁，稀有鱼自然涌现。

export const COMMON_VARIANT = 'common';

export interface RareVariant {
  id: string;
  baseSpecId: string;
  name: string; // 品系全名，如“白化孔雀鱼”
  color: number; // 渲染颜色（数字，不依赖 three）
  mutationRate: number; // 普通亲本繁殖时随机变异出该品系的概率
  inheritRate: number; // 稀有亲本把品系遗传给后代的概率
}

// 各鱼种的稀有品系：每种鱼至少一个，孔雀、神仙各两个
export const RARE_VARIANT_CATALOG: RareVariant[] = [
  // 孔雀鱼
  { id: 'guppy-albino', baseSpecId: 'guppy', name: '白化孔雀鱼', color: 0xf5f0e6, mutationRate: 0.04, inheritRate: 0.6 },
  { id: 'guppy-tuxedo', baseSpecId: 'guppy', name: '礼服孔雀鱼', color: 0x37474f, mutationRate: 0.03, inheritRate: 0.55 },
  // 红绿灯
  { id: 'neon-albino', baseSpecId: 'neon', name: '白金红绿灯', color: 0xfff59d, mutationRate: 0.03, inheritRate: 0.55 },
  // 斑马鱼
  { id: 'zebra-leopard', baseSpecId: 'zebra', name: '豹纹斑马鱼', color: 0xc9a66b, mutationRate: 0.03, inheritRate: 0.55 },
  // 米奇鱼
  { id: 'mickey-gold', baseSpecId: 'mickey', name: '金色米奇鱼', color: 0xffd54f, mutationRate: 0.04, inheritRate: 0.6 },
  // 神仙鱼
  { id: 'angelfish-marble', baseSpecId: 'angelfish', name: '大理石神仙鱼', color: 0x90a4ae, mutationRate: 0.025, inheritRate: 0.5 },
  { id: 'angelfish-gold', baseSpecId: 'angelfish', name: '金色神仙鱼', color: 0xffcc80, mutationRate: 0.02, inheritRate: 0.5 },
  // 玛丽鱼
  { id: 'molly-black', baseSpecId: 'molly', name: '黑玛丽鱼', color: 0x263238, mutationRate: 0.04, inheritRate: 0.6 },
  // 宝莲灯
  { id: 'cardinal-albino', baseSpecId: 'cardinal', name: '白化宝莲灯', color: 0xfffde7, mutationRate: 0.03, inheritRate: 0.55 },
  // 虎皮鱼
  { id: 'tiger-barb-green', baseSpecId: 'tiger-barb', name: '绿虎皮鱼', color: 0x6b8e7a, mutationRate: 0.03, inheritRate: 0.55 },
];

export function getRareVariants(baseSpecId: string): RareVariant[] {
  return RARE_VARIANT_CATALOG.filter((v) => v.baseSpecId === baseSpecId);
}

export function getRareVariant(baseSpecId: string, variantId: string): RareVariant | undefined {
  return RARE_VARIANT_CATALOG.find((v) => v.baseSpecId === baseSpecId && v.id === variantId);
}

// 品系展示名：普通品系回退为传入的基础鱼种名
export function resolveVariantName(baseSpecId: string, variantId: string, baseName: string): string {
  if (variantId === COMMON_VARIANT) return baseName;
  return getRareVariant(baseSpecId, variantId)?.name ?? baseName;
}

export interface RollVariantInput {
  specId: string;
  parentVariants: string[];
  rand: () => number;
}

// 决定一条幼鱼的品系：先判定稀有亲本遗传，再判定随机变异，否则为普通
export function rollOffspringVariant(input: RollVariantInput): string {
  const { specId, parentVariants, rand } = input;
  const rares = getRareVariants(specId);

  // 1. 稀有亲本遗传（去重，按出现顺序）
  const rareParents = [...new Set(parentVariants.filter((v) => v !== COMMON_VARIANT))];
  for (const variantId of rareParents) {
    const config = rares.find((r) => r.id === variantId);
    if (config && rand() < config.inheritRate) return variantId;
  }

  // 2. 随机变异
  for (const config of rares) {
    if (rand() < config.mutationRate) return config.id;
  }

  return COMMON_VARIANT;
}
