// 鱼缸形状规格（纯数据，零 three 依赖）：把写死的单一长方缸数据化，
// 引擎读取容量，渲染层按参数生成几何，游动边界从几何推导。

export type TankShapeId = 'rectangle' | 'cube' | 'cylinder';
export type TankGeometryKind = 'box' | 'cylinder';

export interface TankShapeSpec {
  id: TankShapeId;
  name: string;
  kind: TankGeometryKind;
  // 外形尺寸（box 用 width/depth，cylinder 用 radius）
  width: number;
  depth: number;
  height: number;
  radius: number;
  capacityGrams: number; // 生物总重量上限，按水体体积换算
  // 游动边界（相对缸中心，已留余量）
  motion: {
    yMin: number;
    yMax: number;
    halfX: number; // box 半宽 / cylinder 径向半径
    halfZ: number;
  };
}

export const DEFAULT_TANK_SHAPE: TankShapeId = 'rectangle';

export const TANK_SHAPE_CATALOG: TankShapeSpec[] = [
  {
    id: 'rectangle', name: '长方缸', kind: 'box',
    width: 6, depth: 3, height: 4, radius: 0,
    capacityGrams: 60,
    motion: { yMin: -1.5, yMax: 1.3, halfX: 2.6, halfZ: 1.2 },
  },
  {
    id: 'cube', name: '正方缸', kind: 'box',
    width: 3.6, depth: 3.6, height: 4, radius: 0,
    capacityGrams: 42,
    motion: { yMin: -1.5, yMax: 1.3, halfX: 1.5, halfZ: 1.5 },
  },
  {
    id: 'cylinder', name: '圆柱缸', kind: 'cylinder',
    width: 0, depth: 0, height: 4, radius: 2,
    capacityGrams: 42,
    motion: { yMin: -1.5, yMax: 1.3, halfX: 1.85, halfZ: 1.85 },
  },
];

export function getTankShape(id: string): TankShapeSpec {
  return TANK_SHAPE_CATALOG.find((s) => s.id === id) ?? TANK_SHAPE_CATALOG[0];
}
