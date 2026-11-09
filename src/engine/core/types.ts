// 引擎核心类型：零 DOM、零渲染依赖

export type Behavior = 'normal' | 'anxious' | 'hiding' | 'sick';
export type EquipmentType = 'filter' | 'light' | 'heater' | 'co2';

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

export interface WaterState {
  nh3: number;
  no2: number;
  no3: number;
  b1: number;
  b2: number;
  o2: number;
  co2: number; // 溶解二氧化碳（额外注入量），影响水草光合与 pH
  algae: number; // 藻类生物量：强光富营养爆发，水草竞争与换水可抑制
  ph: number;
  temp: number;
}

// 水草种类：生长条件与净化能力真实作用于引擎
export interface PlantSpec {
  id: string;
  name: string;
  price: number;
  co2Need: number; // 0-1，对 CO2 的需求程度
  lightNeed: number; // 0-1，对光照的需求程度
  maxSize: number; // 成熟大小
  no3Uptake: number; // 吸收硝酸盐的能力系数
}

// 缸内水草实例
export interface PlantState {
  id: string;
  specId: string;
  size: number; // 当前大小，从幼苗生长
  health: number;
}

export interface FishState {
  id: string;
  specId: string;
  name: string;
  age: number; // 年龄（游戏秒）
  hunger: number;
  stress: number;
  health: number;
  weight: number;
  behavior: Behavior;
  breedCooldown: number; // 繁殖冷却（游戏秒），>0 时不能参与繁殖
  variant: string; // 品系 id，普通为 'common'，稀有品系来自变异或遗传
}

export interface EquipmentSpec {
  id: string;
  type: EquipmentType;
  name: string;
  price: number;
  capacity?: number;
  flow?: number;
  brightness?: number;
  power?: number;
  co2Rate?: number; // CO2 设备每游戏秒注入量
}

export interface FishSpec {
  id: string;
  name: string;
  price: number;
  idealTemp: [number, number];
  minSchool: number;
  adultWeight: number;
  lifespan: number; // 自然寿命（游戏秒）
  matureRatio: number; // 性成熟年龄占寿命比例
  breedInterval: number; // 繁殖冷却（游戏秒）
  broodSize: number; // 每次繁殖的幼鱼数量
  incompatibleWith?: string[];
}

export interface InstalledEquipment {
  filter: string | null;
  light: string | null;
  heater: string | null;
  co2: string | null;
}

// 图鉴：自然发现记录，缸内出现过即点亮，未发现的在 UI 显示为问号
export interface CollectionState {
  fish: string[]; // 已发现基础鱼种 specId
  variants: string[]; // 已发现稀有品系 id
  plants: string[]; // 已发现水草 specId
}

// 成就：已达成的里程碑 id，只记录已发生的事，不做任务清单
export interface AchievementState {
  unlocked: string[];
}

// 月卡（陪伴礼遇）状态：expireGameTime 为到期游戏时间，0 表示未激活
export interface MonthlyPassState {
  expireGameTime: number;
  lastClaimDay: number; // 已领取每日奖励的游戏日序号
}

// 支付网关抽象：引擎只依赖接口，具体实现（Mock/微信/支付宝）在外部注入
export interface PaymentResult {
  ok: boolean;
  transactionId?: string;
  reason?: string;
}
export interface PaymentGateway {
  purchase(productId: string): Promise<PaymentResult>;
}

// 付费商品：金币包立即发金币，月卡给持续每日奖励，均不影响模拟数值平衡
export interface PaidProduct {
  id: string;
  kind: 'coin-pack' | 'monthly-pass';
  name: string;
  priceCny: number; // 模拟人民币价格
  grantCoins?: number; // 金币包立即发放数量
  passDays?: number; // 月卡持续游戏日数
  dailyCoins?: number; // 月卡每日奖励
}

// 由已安装装备派生的化学系统运行时参数（内部使用）
export interface EquipmentState {
  filterCapacity: number;
  filterFlow: number;
  lightOn: boolean;
  lightBrightness: number;
  heaterTarget: number;
  co2Rate: number;
}

export interface Snapshot {
  gameTime: number;
  coins: number;
  water: WaterState;
  fishes: FishState[];
  plants: PlantState[];
  ownedEquipment: string[];
  installed: InstalledEquipment;
  lightOn: boolean;
  heaterTarget: number;
  nitrogenEstablished: boolean;
  cycling: boolean;
  guideDone: boolean;
  collection: CollectionState;
  achievement: AchievementState;
  monthlyPass: MonthlyPassState;
  lastDailyRewardDay: number;
  events: string[];
}

// 存档格式当前版本：全应用唯一权威来源，engine 写入与 migrate 迁移目标都引用它，
// 避免多处手写版本号导致漂移。v2：新增水草与 CO2 字段；v3：新增藻类字段；
// v4：新增鱼年龄；v5：新增鱼繁殖冷却；v6：新增鱼品系；v7：新增放置环境；
// v8：新增鱼缸形状；v9：新增图鉴与成就；v10：新增付费点（月卡、每日奖励）
export const CURRENT_SAVE_VERSION = 10;

// 可持久化的完整引擎状态（EventBus 与激活警告属于运行时态，不入库）
export interface PersistedState {
  version: number;
  savedAt: number; // 真实时间戳 ms
  gameTime: number;
  coins: number;
  water: WaterState;
  fishes: FishState[];
  plants: PlantState[];
  ownedEquipment: string[];
  installed: InstalledEquipment;
  lightOn: boolean;
  heaterTarget: number;
  nitrogenEstablished: boolean;
  cycling: boolean;
  guideDone: boolean;
  fishSeq: number;
  plantSeq: number;
  environment: string; // 放置环境 id，默认书房桌面
  tankShape: string; // 鱼缸形状 id，默认长方缸
  collection: CollectionState; // 图鉴发现记录
  achievement: AchievementState; // 成就解锁记录
  lastDailyRewardDay: number; // 已领取免费每日陪伴奖励的游戏日
  monthlyPass: MonthlyPassState; // 月卡状态
}

export interface OfflineResult {
  awayGameSeconds: number;
  events: string[];
}

export interface Engine {
  buyEquipment(specId: string): CommandResult;
  installEquipment(specId: string): CommandResult;
  startCycling(): CommandResult;
  completeGuide(): void;
  buyFish(specId: string): CommandResult;
  buyPlant(specId: string): CommandResult;
  feed(amount: number): CommandResult;
  changeWater(ratio: number): CommandResult;
  setLight(on: boolean): void;
  setHeaterTarget(target: number): void;
  setEnvironment(environmentId: string): CommandResult;
  setTankShape(shapeId: string): CommandResult;
  purchaseProduct(productId: string, gateway: PaymentGateway): Promise<CommandResult>;
  advance(realDtSeconds: number): Snapshot;
  getSnapshot(): Snapshot;
  fastForward(gameSeconds: number): OfflineResult;
  getPersistedState(savedAt: number): PersistedState;
}
