import type { EquipmentSpec, FishSpec, PlantSpec } from '../core/types';
import { GAME_DAY } from './constants';

// 装备目录：参数真实作用于模拟引擎，不是皮肤
export const EQUIPMENT_CATALOG: EquipmentSpec[] = [
  // 过滤器：capacity 决定细菌容量，flow 决定溶氧恢复
  { id: 'filter-wall', type: 'filter', name: '壁挂过滤器', price: 60, capacity: 1, flow: 1 },
  { id: 'filter-canister', type: 'filter', name: '外置滤桶', price: 220, capacity: 2.2, flow: 1.6 },
  { id: 'filter-sump', type: 'filter', name: '底滤系统', price: 580, capacity: 4, flow: 2.5 },
  // 灯具：brightness 影响节律与藻类
  { id: 'light-led', type: 'light', name: '普通 LED 灯', price: 80, brightness: 1 },
  { id: 'light-plant', type: 'light', name: '水草造景灯', price: 260, brightness: 1.6 },
  // 加热棒：power 决定温度维持能力
  { id: 'heater-50', type: 'heater', name: '50W 加热棒', price: 45, power: 1 },
  { id: 'heater-100', type: 'heater', name: '100W 加热棒', price: 95, power: 1.8 },
  // CO2 设备：co2Rate 决定每游戏秒二氧化碳注入量
  { id: 'co2-system', type: 'co2', name: 'CO2 钢瓶套装', price: 180, co2Rate: 0.01 },
];

// 鱼类目录：混养兼容性、群游约束与繁殖参数
export const FISH_CATALOG: FishSpec[] = [
  { id: 'guppy', name: '孔雀鱼', price: 12, idealTemp: [22, 28], minSchool: 1, adultWeight: 3, lifespan: 600 * GAME_DAY, matureRatio: 0.12, breedInterval: 3 * GAME_DAY, broodSize: 2 },
  { id: 'neon', name: '红绿灯', price: 10, idealTemp: [22, 26], minSchool: 3, adultWeight: 1.5, lifespan: 550 * GAME_DAY, matureRatio: 0.15, breedInterval: 4 * GAME_DAY, broodSize: 1 },
  { id: 'zebra', name: '斑马鱼', price: 8, idealTemp: [20, 26], minSchool: 3, adultWeight: 2, lifespan: 550 * GAME_DAY, matureRatio: 0.15, breedInterval: 4 * GAME_DAY, broodSize: 1 },
  { id: 'mickey', name: '米奇鱼', price: 10, idealTemp: [22, 27], minSchool: 1, adultWeight: 2.5, lifespan: 600 * GAME_DAY, matureRatio: 0.12, breedInterval: 3 * GAME_DAY, broodSize: 2 },
  { id: 'angelfish', name: '神仙鱼', price: 35, idealTemp: [24, 28], minSchool: 1, adultWeight: 8, lifespan: 900 * GAME_DAY, matureRatio: 0.18, breedInterval: 5 * GAME_DAY, broodSize: 1, incompatibleWith: ['tiger-barb'] },
  { id: 'molly', name: '玛丽鱼', price: 14, idealTemp: [22, 28], minSchool: 1, adultWeight: 4, lifespan: 650 * GAME_DAY, matureRatio: 0.12, breedInterval: 3 * GAME_DAY, broodSize: 2 },
  { id: 'cardinal', name: '宝莲灯', price: 15, idealTemp: [23, 27], minSchool: 4, adultWeight: 1.8, lifespan: 550 * GAME_DAY, matureRatio: 0.15, breedInterval: 4 * GAME_DAY, broodSize: 1 },
  { id: 'tiger-barb', name: '虎皮鱼', price: 12, idealTemp: [22, 26], minSchool: 4, adultWeight: 3, lifespan: 550 * GAME_DAY, matureRatio: 0.15, breedInterval: 4 * GAME_DAY, broodSize: 1, incompatibleWith: ['angelfish'] },
];

// 水草目录：生长条件与净化能力真实作用于引擎
export const PLANT_CATALOG: PlantSpec[] = [
  { id: 'plant-anubias', name: '水榕', price: 25, co2Need: 0.3, lightNeed: 0.4, maxSize: 0.5, no3Uptake: 0.002 },
  { id: 'plant-hornwort', name: '蜈蚣草', price: 15, co2Need: 0.5, lightNeed: 0.6, maxSize: 0.8, no3Uptake: 0.004 },
  { id: 'plant-moss', name: '莫丝', price: 20, co2Need: 0.4, lightNeed: 0.5, maxSize: 0.4, no3Uptake: 0.0015 },
];

export const TANK_CAPACITY_GRAMS = 60; // 缸内生物总重量上限
export const STARTER_COINS = 500;
