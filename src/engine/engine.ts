import { EventBus } from './core/EventBus';
import { stepChemistry, diluteByWaterChange } from './chemistry/nitrogenCycle';
import { stepPlantLife, stepAlgae } from './chemistry/plants';
import { stepBreeding } from './biology/breeding';
import { COMMON_VARIANT } from './biology/variants';
import { TICK_SECONDS, TIME_SCALE, LIMIT, DAILY_REWARD_COINS, GAME_DAY } from './balance/constants';
import { EQUIPMENT_CATALOG, FISH_CATALOG, PLANT_CATALOG, STARTER_COINS } from './balance/catalog';
import { getEnvironment, DEFAULT_ENVIRONMENT } from './balance/environments';
import { getTankShape, DEFAULT_TANK_SHAPE } from './balance/tankShapes';
import { findPaidProduct } from './balance/paidShop';
import { createEmptyCollection, reconcileCollection } from './progression/collection';
import { evaluateAchievements, getAchievement } from './progression/achievements';
import {
  CURRENT_SAVE_VERSION,
  type Engine, type Snapshot, type WaterState, type FishState, type PlantState,
  type EquipmentState, type PersistedState, type OfflineResult, type CommandResult,
  type InstalledEquipment, type EquipmentSpec, type FishSpec, type PlantSpec,
  type MonthlyPassState, type PaymentGateway,
} from './core/types';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const findEquipment = (id: string): EquipmentSpec | undefined => EQUIPMENT_CATALOG.find((e) => e.id === id);
const findFish = (id: string): FishSpec | undefined => FISH_CATALOG.find((f) => f.id === id);
const findPlant = (id: string): PlantSpec | undefined => PLANT_CATALOG.find((p) => p.id === id);

export function createEngine(initial?: PersistedState): Engine {
  const eventBus = new EventBus();

  // 状态：有存档则恢复，否则默认开局
  const water: WaterState = initial ? { ...initial.water } : {
    nh3: 0, no2: 0, no3: 0, b1: 0.1, b2: 0.1, o2: 8, co2: 0, algae: 0, ph: 7, temp: 22,
  };
  const installed: InstalledEquipment = initial
    ? { ...initial.installed }
    : { filter: 'filter-wall', light: 'light-led', heater: 'heater-50', co2: null };
  const ownedEquipment: string[] = initial
    ? [...initial.ownedEquipment]
    : ['filter-wall', 'light-led', 'heater-50'];
  const fishes: FishState[] = initial ? initial.fishes.map((f) => ({ ...f })) : [];
  const plants: PlantState[] = initial ? initial.plants.map((p) => ({ ...p })) : [];
  let coins = initial?.coins ?? STARTER_COINS;
  let gameTime = initial?.gameTime ?? 0;
  let uneatenFood = 0;
  let lightOn = initial?.lightOn ?? true;
  let heaterTarget = initial?.heaterTarget ?? 25;
  let nitrogenEstablished = initial?.nitrogenEstablished ?? false;
  let cycling = initial?.cycling ?? false;
  let guideDone = initial?.guideDone ?? false;
  let fishSeq = initial?.fishSeq ?? 0;
  let plantSeq = initial?.plantSeq ?? 0;
  let environmentId = initial?.environment ?? DEFAULT_ENVIRONMENT;
  let tankShapeId = initial?.tankShape ?? DEFAULT_TANK_SHAPE;
  let collection = initial?.collection ?? createEmptyCollection();
  let achievement = initial?.achievement ?? { unlocked: [] };
  let lastDailyRewardDay = initial?.lastDailyRewardDay ?? 0;
  let monthlyPass: MonthlyPassState = initial?.monthlyPass ?? { expireGameTime: 0, lastClaimDay: 0 };
  const activeWarnings = new Set<string>();

  const fail = (reason: string): CommandResult => ({ ok: false, reason });

  function effectiveEquipmentState(): EquipmentState {
    const filterSpec = installed.filter ? findEquipment(installed.filter) : undefined;
    const lightSpec = installed.light ? findEquipment(installed.light) : undefined;
    const co2Spec = installed.co2 ? findEquipment(installed.co2) : undefined;
    return {
      filterCapacity: filterSpec?.capacity ?? 0.1,
      filterFlow: filterSpec?.flow ?? 0.2,
      lightOn,
      lightBrightness: lightSpec?.brightness ?? 0,
      heaterTarget,
      co2Rate: co2Spec?.co2Rate ?? 0,
    };
  }

  function raiseWarning(key: string, message: string): void {
    if (!activeWarnings.has(key)) {
      activeWarnings.add(key);
      eventBus.emit(message);
    }
  }
  const clearWarning = (key: string) => activeWarnings.delete(key);

  // 同步图鉴、发放每日/月卡奖励并检查新成就；全部为温和事件，不强制弹窗
  function updateProgression(): void {
    collection = reconcileCollection(collection, fishes, plants);
    const currentDay = Math.floor(gameTime / GAME_DAY);

    // 免费每日陪伴奖励：进入新游戏日且当天未领
    if (currentDay > lastDailyRewardDay) {
      lastDailyRewardDay = currentDay;
      coins += DAILY_REWARD_COINS;
      eventBus.emit(`每日陪伴奖励：${DAILY_REWARD_COINS} 金币`);
    }

    // 月卡每日奖励：处于有效期且当天未领
    if (monthlyPass.expireGameTime > gameTime && currentDay > monthlyPass.lastClaimDay) {
      monthlyPass = { ...monthlyPass, lastClaimDay: currentDay };
      const daily = findPaidProduct('monthly-pass')?.dailyCoins ?? 0;
      if (daily > 0) {
        coins += daily;
        eventBus.emit(`月卡奖励：${daily} 金币`);
      }
    }

    // 新成就：纪念事件 + 金币奖励
    const newAchievements = evaluateAchievements(
      {
        fishCount: fishes.length, plantCount: plants.length, nitrogenEstablished,
        collection, gameTime, coins,
      },
      achievement.unlocked,
    );
    if (newAchievements.length > 0) {
      achievement = { unlocked: [...achievement.unlocked, ...newAchievements] };
      for (const id of newAchievements) {
        const def = getAchievement(id);
        if (def) {
          coins += def.rewardCoins;
          eventBus.emit(`成就纪念：${def.name}——${def.description}（奖励 ${def.rewardCoins} 金币）`);
        }
      }
    }
  }

  function tick(): void {
    // 养水期：持续投入少量氨源，供硝化细菌建立
    if (cycling && !nitrogenEstablished) uneatenFood += 0.02;

    const equipment = effectiveEquipmentState();
    const result = stepChemistry({
      water, fishes, equipment, uneatenFood, dt: TICK_SECONDS,
    });
    uneatenFood = result.uneatenFood;
    stepPlantLife({ water, plants, equipment, findPlant, dt: TICK_SECONDS });
    stepAlgae({
      water, plants, equipment, dt: TICK_SECONDS,
      ambientExposure: getEnvironment(environmentId).ambientExposure,
    });

    if (water.nh3 > LIMIT.nh3Danger) raiseWarning('nh3', '水质警告：氨氮超标，建议换水');
    else clearWarning('nh3');
    if (water.no2 > LIMIT.no2Danger) raiseWarning('no2', '水质警告：亚硝酸盐超标');
    else clearWarning('no2');
    if (water.o2 < 4) raiseWarning('o2', '溶氧不足，鱼可能浮头');
    else clearWarning('o2');
    if (water.co2 > 2) raiseWarning('co2', 'CO2 浓度过高，鱼可能窒息');
    else clearWarning('co2');
    if (water.algae > 2) raiseWarning('algae', '藻类爆发：减少光照或换水');
    else clearWarning('algae');

    for (const fish of fishes) {
      const spec = findFish(fish.specId)!;
      fish.age += TICK_SECONDS;
      const ageRatio = fish.age / spec.lifespan;
      fish.hunger = clamp(fish.hunger + 0.05, 0, 100);
      const toxic = water.nh3 * 1.2 + water.no2;
      const tempOutOfRange = water.temp < spec.idealTemp[0] || water.temp > spec.idealTemp[1] ? 1 : 0;
      const targetStress = clamp(toxic * 30 + (water.o2 < 4 ? 2 : 0) + tempOutOfRange * 25, 0, 100);
      fish.stress += (targetStress - fish.stress) * 0.05;
      if (fish.hunger > 80) fish.stress += 0.05;
      // 衰老：进入寿命后段（80%）健康缓慢下降，越接近寿命越明显
      const senescence = ageRatio > 0.8 ? (ageRatio - 0.8) * 0.05 : 0;
      fish.health = clamp(
        fish.health - (fish.stress > 60 ? 0.02 : 0) + (fish.stress < 20 ? 0.01 : 0) - senescence,
        0, 100,
      );
      if (fish.health < 40) fish.behavior = 'sick';
      else if (fish.stress > 50) fish.behavior = 'anxious';
      else if (fish.hunger > 85) fish.behavior = 'hiding';
      else fish.behavior = 'normal';
      if (fish.health > 60 && fish.hunger < 60 && fish.weight < spec.adultWeight) fish.weight += 0.002;
    }

    // 死亡移除闭环：区分温和的寿终正寝与疾病/环境导致的离开
    const expired = fishes.filter((f) => f.age >= findFish(f.specId)!.lifespan);
    for (const d of expired) eventBus.emit(`${d.name} 寿终正寝`);
    const dead = fishes.filter((f) => f.health <= 0 && !expired.includes(f));
    for (const d of dead) eventBus.emit(`${d.name} 离开了`);
    for (let i = fishes.length - 1; i >= 0; i -= 1) {
      const f = fishes[i];
      if (f.health <= 0 || f.age >= findFish(f.specId)!.lifespan) fishes.splice(i, 1);
    }

    // 自然繁殖：满足成熟、健康、群体与容量条件时产生幼鱼
    const breeding = stepBreeding({
      fishes,
      findSpec: findFish,
      makeId: (specId) => { fishSeq += 1; return `${specId}-${fishSeq}`; },
      capacityGrams: getTankShape(tankShapeId).capacityGrams,
      dt: TICK_SECONDS,
      rand: Math.random,
    });
    for (const event of breeding.events) eventBus.emit(event);

    if (!nitrogenEstablished && water.nh3 < 0.2 && water.no2 < 0.2 && water.b1 > 5 && water.b2 > 5) {
      nitrogenEstablished = true;
      cycling = false;
      eventBus.emit('硝化系统建立完成，可以放鱼了');
    }
    gameTime += TICK_SECONDS;
    updateProgression();
  }

  function getSnapshot(): Snapshot {
    return {
      gameTime, coins,
      water: { ...water },
      fishes: fishes.map((f) => ({ ...f })),
      plants: plants.map((p) => ({ ...p })),
      ownedEquipment: [...ownedEquipment],
      installed: { ...installed },
      lightOn, heaterTarget,
      nitrogenEstablished, cycling, guideDone,
      collection: { fish: [...collection.fish], variants: [...collection.variants], plants: [...collection.plants] },
      achievement: { unlocked: [...achievement.unlocked] },
      monthlyPass: { ...monthlyPass },
      lastDailyRewardDay,
      events: eventBus.drain(),
    };
  }

  return {
    buyEquipment(specId: string) {
      const spec = findEquipment(specId);
      if (!spec) return fail('装备不存在');
      if (ownedEquipment.includes(specId)) return fail('已拥有该装备');
      if (coins < spec.price) return fail('金币不足');
      coins -= spec.price;
      ownedEquipment.push(specId);
      eventBus.emit(`购入 ${spec.name}`);
      return { ok: true };
    },

    installEquipment(specId: string) {
      const spec = findEquipment(specId);
      if (!spec || !ownedEquipment.includes(specId)) return fail('未拥有该装备');
      installed[spec.type] = specId;
      eventBus.emit(`已安装 ${spec.name}`);
      return { ok: true };
    },

    startCycling() {
      if (nitrogenEstablished) return fail('硝化系统已建立，无需重复养水');
      if (cycling) return fail('已经在养水中，请稍候');
      cycling = true;
      eventBus.emit('开始养水：硝化系统建立中');
      return { ok: true };
    },

    completeGuide() {
      guideDone = true;
    },

    buyFish(specId: string) {
      const spec = findFish(specId);
      if (!spec) return fail('鱼种不存在');
      if (!nitrogenEstablished) return fail('硝化系统尚未建立，请先养水');
      if (coins < spec.price) return fail('金币不足');
      const totalWeight = fishes.reduce((sum, f) => sum + f.weight, 0);
      if (totalWeight + spec.adultWeight > getTankShape(tankShapeId).capacityGrams) {
        return fail('缸内密度已达上限');
      }
      if (fishes.some((f) => spec.incompatibleWith?.includes(f.specId))) {
        return fail(`与缸内鱼种不宜混养`);
      }
      coins -= spec.price;
      fishSeq += 1;
      fishes.push({
        id: `${spec.id}-${fishSeq}`, specId: spec.id, name: spec.name,
        age: 0, hunger: 20, stress: 0, health: 100, weight: spec.adultWeight * 0.5, behavior: 'normal',
        breedCooldown: 0,
        variant: COMMON_VARIANT,
      });
      // 群游不足提示（不阻断）
      const sameKind = fishes.filter((f) => f.specId === specId).length;
      if (sameKind < spec.minSchool) {
        eventBus.emit(`提示：${spec.name}建议至少 ${spec.minSchool} 条群游`);
      }
      eventBus.emit(`放入 ${spec.name}`);
      updateProgression();
      return { ok: true };
    },

    buyPlant(specId) {
      const spec = findPlant(specId);
      if (!spec) return fail('水草不存在');
      if (coins < spec.price) return fail('金币不足');
      coins -= spec.price;
      plantSeq += 1;
      // 从幼苗开始，初始大小约为成熟大小的两成
      plants.push({ id: `${spec.id}-${plantSeq}`, specId: spec.id, size: spec.maxSize * 0.2, health: 100 });
      eventBus.emit(`种下 ${spec.name}`);
      updateProgression();
      return { ok: true };
    },

    feed(amount: number) {
      if (fishes.length === 0) return fail('缸里还没有鱼');
      uneatenFood += amount * 0.4;
      for (const fish of fishes) fish.hunger = clamp(fish.hunger - amount * 10, 0, 100);
      eventBus.emit(`喂食 ${amount} 份`);
      return { ok: true };
    },

    changeWater(ratio: number) {
      diluteByWaterChange(water, ratio);
      eventBus.emit(`换水 ${Math.round(ratio * 100)}%`);
      return { ok: true };
    },

    setLight(on: boolean) { lightOn = on; },
    setHeaterTarget(target: number) { heaterTarget = clamp(target, 18, 32); },

    setEnvironment(nextId: string) {
      const config = getEnvironment(nextId);
      if (config.id !== nextId) return fail('环境不存在');
      environmentId = config.id;
      eventBus.emit(`把鱼缸移到了${config.name}`);
      return { ok: true };
    },

    setTankShape(nextId: string) {
      const spec = getTankShape(nextId);
      if (spec.id !== nextId) return fail('形状不存在');
      // 新缸容量若装不下现有鱼，拒绝切换，避免生物量超限
      const currentWeight = fishes.reduce((sum, f) => sum + f.weight, 0);
      if (currentWeight > spec.capacityGrams) {
        return fail('现有鱼太多，这个缸装不下，先减少一些鱼');
      }
      tankShapeId = spec.id;
      eventBus.emit(`把鱼缸换成了${spec.name}`);
      return { ok: true };
    },

    async purchaseProduct(productId, gateway: PaymentGateway) {
      const product = findPaidProduct(productId);
      if (!product) return fail('商品不存在');
      const payment = await gateway.purchase(productId);
      if (!payment.ok) return fail(payment.reason ?? '支付失败');
      if (product.kind === 'coin-pack' && product.grantCoins) {
        coins += product.grantCoins;
        eventBus.emit(`获得 ${product.grantCoins} 金币`);
      } else if (product.kind === 'monthly-pass' && product.passDays) {
        // 月卡从当前游戏时间起算；已有效则在到期时间基础上顺延
        const base = monthlyPass.expireGameTime > gameTime ? monthlyPass.expireGameTime : gameTime;
        monthlyPass = { ...monthlyPass, expireGameTime: base + product.passDays * GAME_DAY };
        eventBus.emit(`月卡已开通，持续 ${product.passDays} 个游戏日`);
      }
      return { ok: true };
    },

    advance(realDtSeconds: number) {
      const gameTicks = Math.max(1, Math.round((realDtSeconds * TIME_SCALE) / TICK_SECONDS));
      for (let i = 0; i < gameTicks; i += 1) tick();
      return getSnapshot();
    },

    fastForward(gameSeconds: number): OfflineResult {
      const ticks = Math.floor(gameSeconds / TICK_SECONDS);
      for (let i = 0; i < ticks; i += 1) tick();
      // 事件去重后返回，避免摘要刷屏
      const events = [...new Set(eventBus.drain())];
      return { awayGameSeconds: ticks * TICK_SECONDS, events };
    },

    getSnapshot,

    getPersistedState(savedAt: number): PersistedState {
      return {
        version: CURRENT_SAVE_VERSION, savedAt, gameTime, coins,
        water: { ...water },
        fishes: fishes.map((f) => ({ ...f })),
        plants: plants.map((p) => ({ ...p })),
        ownedEquipment: [...ownedEquipment],
        installed: { ...installed },
        lightOn, heaterTarget, nitrogenEstablished, cycling, guideDone, fishSeq, plantSeq,
        environment: environmentId,
        tankShape: tankShapeId,
        collection: {
          fish: [...collection.fish], variants: [...collection.variants], plants: [...collection.plants],
        },
        achievement: { unlocked: [...achievement.unlocked] },
        lastDailyRewardDay,
        monthlyPass: { ...monthlyPass },
      };
    },
  };
}
