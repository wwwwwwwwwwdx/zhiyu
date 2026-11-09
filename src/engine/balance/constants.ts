// 数值平衡常量：集中管理，调参不改系统代码

export const TICK_SECONDS = 1; // 逻辑步长（游戏秒）
export const TIME_SCALE = 60; // 现实 1 秒 = 游戏 1 分钟
export const GAME_DAY = 24 * 3600; // 一个游戏天对应的游戏秒

export const RATE = {
  k1: 0.08, // NH3 -> NO2 反应速率
  k2: 0.06, // NO2 -> NO3 反应速率
  bacteriaGrowth: 0.015, // 细菌生长速率
  bacteriaDecay: 0.0001, // 无底物时休眠，仅活跃期做平衡
  excretionPerGram: 0.00012, // 每克鱼每游戏秒排泄贡献
  wasteDecay: 0.05, // 残饵分解为 NH3 的速率
  o2Recovery: 0.04,
  o2ConsumptionPerGram: 0.00002,
};

export const LIMIT = {
  nh3Danger: 0.6,
  no2Danger: 0.6,
  no3Danger: 40,
  bacteriaMaxBase: 10,
  tempMin: 18,
  tempIdeal: 25,
  tempMax: 32,
};

export const DAILY_REWARD_COINS = 40; // 免费每日陪伴奖励，保证零氪可持续玩

export const STARTER_FISH = [
  { id: 'f1', name: '孔雀鱼' },
  { id: 'f2', name: '红绿灯' },
  { id: 'f3', name: '斑马鱼' },
];
