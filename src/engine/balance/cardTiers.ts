// 卡册分级体系：普通→银→金→铂金→钻石→七彩→限定
// 每张图鉴卡片按所属分级渲染边框颜色、顶部徽章与特殊动效

export type CardTier =
  | 'common'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'rainbow'
  | 'limited';

export interface TierMeta {
  label: string;
  border: string;       // 卡片边框色
  glow: string;         // 外发光
  badge: string;        // 顶部徽章文字
  badgeColor: string;   // 徽章底色
}

export const CARD_TIERS: Record<CardTier, TierMeta> = {
  common:   { label: '普通', border: 'rgba(160,170,180,0.5)',  glow: 'none',            badge: '',        badgeColor: 'transparent' },
  silver:   { label: '银卡', border: 'rgba(170,185,200,0.9)',  glow: '0 0 6px rgba(180,200,220,0.4)', badge: '银', badgeColor: '#c8d4e0' },
  gold:     { label: '金卡', border: 'rgba(220,175,60,0.95)', glow: '0 0 8px rgba(230,190,80,0.5)',  badge: '金', badgeColor: '#e6b83a' },
  platinum: { label: '铂金', border: 'rgba(180,210,235,0.95)',glow: '0 0 10px rgba(190,220,245,0.6)',badge: '铂', badgeColor: '#b8d4e8' },
  diamond:  { label: '钻石', border: 'rgba(140,220,240,0.95)', glow: '0 0 12px rgba(120,220,245,0.7)',badge: '钻', badgeColor: '#8adcee' },
  rainbow:  { label: '七彩', border: '',                       glow: '0 0 14px rgba(200,120,255,0.6)', badge: '彩', badgeColor: '#c860e0' },
  limited:  { label: '限定', border: '',                       glow: '0 0 16px rgba(255,180,80,0.7)',  badge: '限', badgeColor: '#e06030' },
};

// 鱼按价格分级
const FISH_TIER: Record<string, CardTier> = {
  'zebra': 'common',
  'neon': 'common',
  'mickey': 'common',
  'platy': 'common',
  'guppy': 'silver',
  'tiger-barb': 'silver',
  'molly': 'silver',
  'cardinal': 'silver',
  'cory': 'gold',
  'goldfish': 'gold',
  'betta': 'diamond',
  'angelfish': 'diamond',
};

// 水草按价格分级
const PLANT_TIER: Record<string, CardTier> = {
  'plant-hornwort': 'silver',
  'plant-moss': 'gold',
  'plant-anubias': 'gold',
  'plant-rotala': 'platinum',
  'plant-sword': 'platinum',
};

// 稀有品系统一七彩
export function variantTier(_variantId: string): CardTier {
  return 'rainbow';
}

// 成就分级：普通成就=金，特殊里程碑=限定
const ACHIEVEMENT_TIER: Record<string, CardTier> = {
  // 养鱼数里程碑最高级设为限定
};

export function fishTier(specId: string): CardTier {
  return FISH_TIER[specId] ?? 'common';
}

export function plantTier(specId: string): CardTier {
  return PLANT_TIER[specId] ?? 'common';
}

export function achievementTier(achId: string): CardTier {
  return ACHIEVEMENT_TIER[achId] ?? 'gold';
}

// 哪些是限定卡（点击触发全屏动效）
export const LIMITED_CARDS = new Set<string>([
  // 留空，后续配置限定卡 id；目前七彩品系已有足够辨识度
]);
