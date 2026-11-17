// 鱼游动数学（纯函数，零 three 依赖）：按鱼种的水层偏好、速度、转向特性做自主游走，
// 并在缸内边界平滑避让。位置为运行时表现数据，不写入存档，可独立单测。
// 约定：heading 等于 mesh.rotation.y；前进方向 vx=cos(heading)、vz=-sin(heading)。

export type WaterLevel = 'top' | 'mid' | 'bottom';

export interface MotionConfig {
  waterLevel: WaterLevel;
  centerY: number; // 偏好水层的垂直中心
  yRange: number; // 上下活动幅度
  speed: number; // 基础游速（单位/秒）
  turn: number; // 随机转向强度
}

// 游动边界：box 为矩形（halfX/halfZ 半轴），cylinder 为圆形（径向半径 halfX）
export interface MotionBounds {
  kind: 'box' | 'cylinder';
  yMin: number;
  yMax: number;
  halfX: number;
  halfZ: number;
}

export interface MotionState {
  x: number;
  y: number;
  z: number;
  heading: number;
  seed: number;
  // 平滑后的转向角速度（弧度/秒）：用于渲染层侧倾，直接取每帧航向差会带入
  // 随机转向的白噪声，导致鱼身逐帧抖动
  turnRate: number;
}

// 默认长方缸边界（等价历史写死值，砂面约 -1.575）
export const DEFAULT_MOTION_BOUNDS: MotionBounds = {
  kind: 'box', yMin: -1.5, yMax: 1.3, halfX: 2.6, halfZ: 1.2,
};
// 向后兼容别名
export const TANK_MOTION_BOUNDS = DEFAULT_MOTION_BOUNDS;

// 鱼种运动配置：反映真实习性差异
// yRange 是垂直起伏的单边幅度：真鱼以水平巡游为主，上下只是小幅起伏，
// 幅度过大会变成"电梯式直上直下"，这里统一收到体长的量级
export const FISH_MOTION_CONFIG: Record<string, MotionConfig> = {
  // 卵胎生鳉鱼：偏上层、灵动
  guppy: { waterLevel: 'top', centerY: 0.7, yRange: 0.2, speed: 1.1, turn: 1.2 },
  mickey: { waterLevel: 'top', centerY: 0.6, yRange: 0.2, speed: 1.0, turn: 1.1 },
  molly: { waterLevel: 'top', centerY: 0.3, yRange: 0.24, speed: 0.9, turn: 1.0 },
  // 灯鱼：中层群游，转向平稳
  neon: { waterLevel: 'mid', centerY: -0.2, yRange: 0.22, speed: 1.0, turn: 0.8 },
  cardinal: { waterLevel: 'mid', centerY: -0.2, yRange: 0.2, speed: 0.9, turn: 0.7 },
  zebra: { waterLevel: 'mid', centerY: -0.1, yRange: 0.24, speed: 1.5, turn: 1.4 },
  'tiger-barb': { waterLevel: 'mid', centerY: -0.2, yRange: 0.24, speed: 1.4, turn: 1.3 },
  // 神仙鱼：缓慢优雅，垂直上下游动幅度大（相对其它鱼仍为小幅）
  angelfish: { waterLevel: 'mid', centerY: -0.2, yRange: 0.38, speed: 0.6, turn: 0.6 },
  // 后加鱼种：金鱼稳健、斗鱼上层慢游、月光鱼中层、鼠鱼贴底觅食
  goldfish: { waterLevel: 'mid', centerY: -0.1, yRange: 0.28, speed: 0.7, turn: 0.7 },
  betta: { waterLevel: 'top', centerY: 0.75, yRange: 0.18, speed: 0.65, turn: 0.9 },
  platy: { waterLevel: 'mid', centerY: 0.1, yRange: 0.2, speed: 1.05, turn: 1.0 },
  cory: { waterLevel: 'bottom', centerY: -1.15, yRange: 0.1, speed: 0.8, turn: 0.9 },
};

const DEFAULT_CONFIG: MotionConfig = {
  waterLevel: 'mid', centerY: -0.2, yRange: 0.22, speed: 1, turn: 1,
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// 角度插值，处理 ±PI 环绕
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// 在边界内生成随机水平位置
function randomHorizontal(bounds: MotionBounds, rand: () => number): { x: number; z: number } {
  if (bounds.kind === 'cylinder') {
    // 圆内均匀随机点
    const angle = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * bounds.halfX;
    return { x: r * Math.cos(angle), z: r * Math.sin(angle) };
  }
  return { x: (rand() - 0.5) * 2 * bounds.halfX, z: (rand() - 0.5) * 2 * bounds.halfZ };
}

export function createMotionState(
  specId: string, rand: () => number, bounds: MotionBounds = DEFAULT_MOTION_BOUNDS,
): MotionState {
  const config = FISH_MOTION_CONFIG[specId] ?? DEFAULT_CONFIG;
  const horizontal = randomHorizontal(bounds, rand);
  return {
    x: horizontal.x,
    y: config.centerY + (rand() - 0.5) * config.yRange,
    z: horizontal.z,
    heading: rand() * Math.PI * 2,
    seed: rand() * Math.PI * 2,
    turnRate: 0,
  };
}

export interface UpdateMotionOptions {
  state: MotionState;
  specId: string;
  behaviorSpeed: number;
  dt: number;
  time: number; // 累计秒，用于周期性摆动
  rand: () => number;
  bounds?: MotionBounds;
}

export function updateMotion(opts: UpdateMotionOptions): MotionState {
  const { state, specId, behaviorSpeed, dt, time, rand } = opts;
  const bounds = opts.bounds ?? DEFAULT_MOTION_BOUNDS;
  const config = FISH_MOTION_CONFIG[specId] ?? DEFAULT_CONFIG;
  const headingBefore = state.heading;
  let heading = state.heading;

  // 1. 随机游走转向 + 平滑周期，避免纯随机抖动
  heading += (rand() - 0.5) * config.turn * dt;
  heading += Math.sin(time * 0.3 + state.seed) * config.turn * 0.25 * dt;

  // 2. 靠近边界时平滑转向缸中心
  const margin = 0.8;
  const nearBound = bounds.kind === 'cylinder'
    ? Math.hypot(state.x, state.z) > bounds.halfX - margin
    : state.x > bounds.halfX - margin || state.x < -bounds.halfX + margin ||
      state.z > bounds.halfZ - margin || state.z < -bounds.halfZ + margin;
  if (nearBound) {
    // 指向中心的 heading：vx∝-x、vz∝-z，故 heading=atan2(z, -x)
    const desired = Math.atan2(state.z, -state.x);
    heading = lerpAngle(heading, desired, clamp(2 * dt, 0, 1));
  }

  // 3. 沿 heading 前进
  const speed = config.speed * behaviorSpeed;
  let x = state.x + Math.cos(heading) * speed * dt;
  let z = state.z - Math.sin(heading) * speed * dt;

  // 硬 clamp 兜底，杜绝穿缸
  if (bounds.kind === 'cylinder') {
    const radial = Math.hypot(x, z);
    if (radial > bounds.halfX) {
      const k = bounds.halfX / radial;
      x *= k;
      z *= k;
    }
  } else {
    x = clamp(x, -bounds.halfX, bounds.halfX);
    z = clamp(z, -bounds.halfZ, bounds.halfZ);
  }

  // 4. 垂直方向：两层慢正弦叠加，在偏好水层附近小幅起伏。
  // 单层正弦 + 大振幅会让鱼像电梯一样直上直下，两层不同周期能打破节拍感
  const targetY = config.centerY
    + Math.sin(time * 0.21 + state.seed) * config.yRange * 0.7
    + Math.sin(time * 0.53 + state.seed * 1.7) * config.yRange * 0.3;
  // 跟随速率放慢：浴缸里的鱼不会瞬间升降，慢速跟随更自然
  let y = state.y + (targetY - state.y) * clamp(0.9 * dt, 0, 1);
  y = clamp(y, bounds.yMin, bounds.yMax);

  // 5. 转向角速度做低通平滑：随机转向是逐帧白噪声，直接用会让鱼身每帧左右抖
  const rawTurn = dt > 1e-6 ? (heading - headingBefore) / dt : 0;
  const turnRate = state.turnRate + (rawTurn - state.turnRate) * clamp(4 * dt, 0, 1);

  return { x, y, z, heading, seed: state.seed, turnRate };
}
