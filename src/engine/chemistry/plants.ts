import type { WaterState, PlantState, EquipmentState, PlantSpec } from '../core/types';
import { LIMIT } from '../balance/constants';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface PlantLifeInput {
  water: WaterState;
  plants: PlantState[];
  equipment: EquipmentState;
  findPlant: (id: string) => PlantSpec | undefined;
  dt: number;
}

// 单步水草与 CO2 系统：CO2 注入/逸散、水草吸收 NO3 与 CO2、光合产氧、pH 联动
export function stepPlantLife(input: PlantLifeInput): void {
  const { water, plants, equipment, dt } = input;

  // CO2 注入：安装 CO2 设备即持续注入
  if (equipment.co2Rate > 0) water.co2 += equipment.co2Rate * dt;
  // CO2 自然逸散（向大气平衡）：用指数衰减，对任意 dt 都稳定，避免大 dt 下被一次性清零
  water.co2 = clamp(water.co2 * Math.exp(-0.02 * dt), 0, 10);

  const tempFactor = 1 - Math.min(1, Math.abs(water.temp - LIMIT.tempIdeal) / 10);

  for (const plant of plants) {
    const spec = input.findPlant(plant.specId);
    if (!spec) continue;

    // 光照因子：开灯且亮度满足需求；关灯时仅维持低水平呼吸
    const lightFactor = equipment.lightOn
      ? clamp(equipment.lightBrightness / Math.max(0.2, spec.lightNeed), 0, 1)
      : 0.05;
    // CO2 满足度
    const co2Factor = clamp(water.co2 / Math.max(0.2, spec.co2Need), 0, 1);
    const growth = clamp(lightFactor * co2Factor * tempFactor, 0, 1);

    // 吸收 NO3：水草净化作用，随当前大小与生长状况变化
    water.no3 = Math.max(0, water.no3 - spec.no3Uptake * plant.size * growth * dt);
    // 吸收 CO2（光合作用）
    water.co2 = Math.max(0, water.co2 - 0.006 * plant.size * growth * dt);

    if (equipment.lightOn) {
      // 光合产氧
      water.o2 = clamp(water.o2 + 0.02 * plant.size * growth * dt, 0, 12);
    } else {
      // 黑暗呼吸：耗氧并释放少量 CO2
      water.o2 = Math.max(0, water.o2 - 0.005 * plant.size * dt);
      water.co2 = clamp(water.co2 + 0.003 * plant.size * dt, 0, 10);
    }

    // 生长与健康
    if (plant.size < spec.maxSize) {
      plant.size = clamp(plant.size + 0.0008 * growth * dt, 0, spec.maxSize);
    }
    const healthTarget = growth > 0.3 ? 100 : growth * 100;
    plant.health += (healthTarget - plant.health) * 0.02;
  }

  // pH 联动：溶解 CO2 形成碳酸，浓度越高 pH 越低
  water.ph = clamp(7 - water.co2 * 0.5, 6, 8);
}

export interface AlgaeInput {
  water: WaterState;
  plants: PlantState[];
  equipment: EquipmentState;
  dt: number;
  ambientExposure?: number; // 环境光（如窗台），关灯时也存在
}

// 单步藻类：强光 + 高 NO3 促进爆发，水草竞争抑制，无光照/低营养时自然消退
export function stepAlgae(input: AlgaeInput): void {
  const { water, plants, equipment, dt, ambientExposure = 0 } = input;
  // 光照暴露：灯光暴露 + 环境光，二者取叠加并 clamp
  const lampExposure = equipment.lightOn ? clamp(equipment.lightBrightness / 1.2, 0, 1) : 0;
  const lightExposure = clamp(lampExposure + ambientExposure, 0, 1);
  // 营养盐：NO3 浓度越高越易爆发
  const nutrient = clamp(water.no3 / 20, 0, 1);
  // 水草竞争（化感与营养竞争）：水草越茂盛藻类越受抑制
  const plantTotal = plants.reduce((sum, p) => sum + p.size, 0);
  const competition = clamp(plantTotal / 2, 0, 1);

  const net = lightExposure * nutrient * (1 - competition) * 0.05 - 0.008;
  water.algae = clamp(water.algae + net * dt, 0, 10);
}
