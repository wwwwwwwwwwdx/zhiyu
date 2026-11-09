import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine';
import { stepPlantLife, stepAlgae } from '../src/engine/chemistry/plants';
import { PLANT_CATALOG } from '../src/engine/balance/catalog';
import type { WaterState, PlantState, EquipmentState } from '../src/engine/core/types';

const findPlant = (id: string) => PLANT_CATALOG.find((p) => p.id === id);

function makeWater(over: Partial<WaterState> = {}): WaterState {
  return { nh3: 0, no2: 0, no3: 10, b1: 0, b2: 0, o2: 8, co2: 0.5, algae: 0, ph: 7, temp: 25, ...over };
}
function makeEquip(over: Partial<EquipmentState> = {}): EquipmentState {
  return {
    filterCapacity: 1, filterFlow: 1, lightOn: true, lightBrightness: 1.6,
    heaterTarget: 25, co2Rate: 0.01, ...over,
  };
}

describe('水草与 CO2 引擎集成', () => {
  it('安装 CO2 设备后溶解 co2 升高', () => {
    const engine = createEngine();
    engine.buyEquipment('co2-system');
    engine.installEquipment('co2-system');
    const before = engine.getSnapshot().water.co2;
    engine.advance(2);
    expect(engine.getSnapshot().water.co2).toBeGreaterThan(before);
  });

  it('buyPlant 扣款并种下幼苗，金币不足被拦截', () => {
    const engine = createEngine();
    const result = engine.buyPlant('plant-anubias');
    expect(result.ok).toBe(true);
    expect(engine.getSnapshot().plants).toHaveLength(1);
    expect(engine.getSnapshot().plants[0].size).toBeCloseTo(0.1, 1);
  });

  it('光照与 CO2 充足时水草生长', () => {
    const engine = createEngine();
    engine.buyEquipment('co2-system');
    engine.installEquipment('co2-system');
    engine.buyPlant('plant-anubias');
    const startSize = engine.getSnapshot().plants[0].size;
    engine.advance(4);
    expect(engine.getSnapshot().plants[0].size).toBeGreaterThan(startSize);
  });
});

describe('stepPlantLife 纯函数', () => {
  it('水草吸收 NO3 降低硝酸盐', () => {
    const water = makeWater({ co2: 2 });
    const plants: PlantState[] = [{ id: 'p1', specId: 'plant-hornwort', size: 0.8, health: 100 }];
    stepPlantLife({ water, plants, equipment: makeEquip(), findPlant, dt: 60 });
    expect(water.no3).toBeLessThan(10);
  });

  it('开灯光合产氧，关灯呼吸耗氧', () => {
    const lit = makeWater({ o2: 8, co2: 2 });
    stepPlantLife({
      water: lit, plants: [{ id: 'p', specId: 'plant-hornwort', size: 0.8, health: 100 }],
      equipment: makeEquip({ lightOn: true }), findPlant, dt: 60,
    });
    expect(lit.o2).toBeGreaterThan(8);

    const dark = makeWater({ o2: 8 });
    stepPlantLife({
      water: dark, plants: [{ id: 'p', specId: 'plant-hornwort', size: 0.8, health: 100 }],
      equipment: makeEquip({ lightOn: false }), findPlant, dt: 60,
    });
    expect(dark.o2).toBeLessThan(8);
  });

  it('CO2 升高拉动 pH 下降', () => {
    const water = makeWater({ co2: 1 });
    stepPlantLife({
      water, plants: [{ id: 'p', specId: 'plant-anubias', size: 0.5, health: 100 }],
      equipment: makeEquip(), findPlant, dt: 30,
    });
    expect(water.ph).toBeLessThan(7);
  });
});

describe('stepAlgae 藻类', () => {
  it('强光高 NO3 且无水草时藻类爆发', () => {
    const water = makeWater({ no3: 40, algae: 0.5 });
    stepAlgae({ water, plants: [], equipment: makeEquip({ lightOn: true, lightBrightness: 1.6 }), dt: 60 });
    expect(water.algae).toBeGreaterThan(0.5);
  });

  it('关灯后藻类自然消退', () => {
    const water = makeWater({ algae: 1 });
    stepAlgae({ water, plants: [], equipment: makeEquip({ lightOn: false }), dt: 60 });
    expect(water.algae).toBeLessThan(1);
  });

  it('窗台环境光在关灯时仍能缓慢促进藻类', () => {
    const water = makeWater({ no3: 40, algae: 0.5 });
    stepAlgae({
      water, plants: [], equipment: makeEquip({ lightOn: false }),
      dt: 60, ambientExposure: 0.35,
    });
    expect(water.algae).toBeGreaterThan(0.5);
  });

  it('茂盛水草竞争抑制藻类，增长低于无草情形', () => {
    const noPlant = makeWater({ no3: 40, algae: 0.5 });
    stepAlgae({ water: noPlant, plants: [], equipment: makeEquip({ lightOn: true, lightBrightness: 1.6 }), dt: 60 });

    const withPlant = makeWater({ no3: 40, algae: 0.5 });
    const plants: PlantState[] = [{ id: 'p', specId: 'plant-hornwort', size: 0.8, health: 100 }];
    stepAlgae({ water: withPlant, plants, equipment: makeEquip({ lightOn: true, lightBrightness: 1.6 }), dt: 60 });

    expect(withPlant.algae).toBeLessThan(noPlant.algae);
  });
});
