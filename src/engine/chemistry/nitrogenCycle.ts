import { RATE, LIMIT } from '../balance/constants';
import type { EquipmentState, WaterState, FishState } from '../core/types';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// 环境适宜度：温度与溶氧偏离时抑制硝化反应
function suitability(water: WaterState): number {
  const tempFactor = 1 - Math.min(1, Math.abs(water.temp - LIMIT.tempIdeal) / 10);
  const o2Factor = clamp(water.o2 / 8, 0, 1);
  return clamp(tempFactor * o2Factor, 0, 1);
}

export interface ChemistryInput {
  water: WaterState;
  fishes: FishState[];
  equipment: EquipmentState;
  uneatenFood: number;
  dt: number; // 游戏秒
}

// 单步氮循环与水质积分（固定步长调用）
export function stepChemistry(input: ChemistryInput): { uneatenFood: number } {
  const { water, fishes, equipment, dt } = input;
  let { uneatenFood } = input;
  const s = suitability(water);

  // 污染源：鱼排泄 + 残饵分解
  const totalWeight = fishes.reduce((sum, f) => sum + f.weight, 0);
  const excretion = totalWeight * RATE.excretionPerGram * dt;
  const decomposed = uneatenFood * RATE.wasteDecay * dt;
  uneatenFood = Math.max(0, uneatenFood - decomposed);

  const bacteriaMax = LIMIT.bacteriaMaxBase * equipment.filterCapacity;

  // 硝化反应通量
  const nitrify1 = RATE.k1 * water.b1 * s * water.nh3 * dt;
  const nitrify2 = RATE.k2 * water.b2 * s * water.no2 * dt;

  water.nh3 = clamp(water.nh3 + excretion + decomposed - nitrify1, 0, 10);
  water.no2 = clamp(water.no2 + nitrify1 - nitrify2, 0, 10);
  water.no3 = clamp(water.no3 + nitrify2, 0, 100);

  // 细菌：有底物且滤材有容量时增长；无底物进入休眠，不衰减（模拟细菌休眠而非饿死）
  const hasNh3 = water.nh3 > 0.01;
  const hasNo2 = water.no2 > 0.01;
  const grow1 = hasNh3 ? RATE.bacteriaGrowth * s * (bacteriaMax - water.b1) : 0;
  const grow2 = hasNo2 ? RATE.bacteriaGrowth * s * (bacteriaMax - water.b2) : 0;
  const decay1 = hasNh3 ? RATE.bacteriaDecay : 0;
  const decay2 = hasNo2 ? RATE.bacteriaDecay : 0;
  water.b1 = clamp(water.b1 + grow1 * dt - decay1 * dt, 0, bacteriaMax);
  water.b2 = clamp(water.b2 + grow2 * dt - decay2 * dt, 0, bacteriaMax);

  // 溶氧：消耗与恢复
  const o2Consume = totalWeight * RATE.o2ConsumptionPerGram * dt;
  water.o2 = clamp(water.o2 + RATE.o2Recovery * (equipment.filterFlow * 8 - water.o2) * dt - o2Consume, 0, 12);

  // 温度向加热棒目标趋近
  const tempDelta = (equipment.heaterTarget - water.temp) * 0.02 * dt;
  water.temp = clamp(water.temp + tempDelta, LIMIT.tempMin, LIMIT.tempMax);

  return { uneatenFood };
}

export function diluteByWaterChange(water: WaterState, ratio: number): void {
  const r = clamp(ratio, 0, 0.5);
  water.nh3 *= 1 - r;
  water.no2 *= 1 - r;
  water.no3 *= 1 - r;
  water.co2 *= 1 - r;
  water.algae *= 1 - r; // 换水物理清除藻类
  water.b1 *= 1 - r * 0.1;
  water.b2 *= 1 - r * 0.1;
}
