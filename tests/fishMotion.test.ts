import { describe, it, expect } from 'vitest';
import {
  createMotionState, updateMotion, FISH_MOTION_CONFIG, TANK_MOTION_BOUNDS,
  type MotionState, type MotionBounds,
} from '../src/render/fishMotion';

const fixedRand = () => 0.5;

const cylinderBounds: MotionBounds = {
  kind: 'cylinder', yMin: -1.5, yMax: 1.3, halfX: 1.85, halfZ: 1.85,
};

function runMany(
  state: MotionState, specId: string, steps: number,
  behaviorSpeed = 1, bounds: MotionBounds = TANK_MOTION_BOUNDS,
): MotionState {
  let current = state;
  for (let i = 0; i < steps; i++) {
    current = updateMotion({
      state: current, specId, behaviorSpeed, dt: 0.05, time: i * 0.05,
      rand: fixedRand, bounds,
    });
  }
  return current;
}

describe('鱼游动差异化', () => {
  it('初始运动状态位于缸内边界中', () => {
    const state = createMotionState('guppy', fixedRand);
    expect(state.x).toBeGreaterThanOrEqual(-TANK_MOTION_BOUNDS.halfX);
    expect(state.x).toBeLessThanOrEqual(TANK_MOTION_BOUNDS.halfX);
    expect(state.y).toBeGreaterThanOrEqual(TANK_MOTION_BOUNDS.yMin);
    expect(state.y).toBeLessThanOrEqual(TANK_MOTION_BOUNDS.yMax);
  });

  it('连续多步后始终不穿缸（box 矩形边界）', () => {
    const state = runMany(createMotionState('zebra', fixedRand), 'zebra', 200);
    expect(state.x).toBeGreaterThanOrEqual(-TANK_MOTION_BOUNDS.halfX);
    expect(state.x).toBeLessThanOrEqual(TANK_MOTION_BOUNDS.halfX);
    expect(state.z).toBeGreaterThanOrEqual(-TANK_MOTION_BOUNDS.halfZ);
    expect(state.z).toBeLessThanOrEqual(TANK_MOTION_BOUNDS.halfZ);
    expect(state.y).toBeGreaterThanOrEqual(TANK_MOTION_BOUNDS.yMin);
    expect(state.y).toBeLessThanOrEqual(TANK_MOTION_BOUNDS.yMax);
  });

  it('从边界附近出发会被拉回内侧，不越界', () => {
    const start: MotionState = {
      x: TANK_MOTION_BOUNDS.halfX, y: 0, z: 0, heading: 0, seed: 1,
    };
    const after = runMany(start, 'neon', 100);
    expect(after.x).toBeLessThanOrEqual(TANK_MOTION_BOUNDS.halfX);
    expect(after.x).toBeLessThan(TANK_MOTION_BOUNDS.halfX); // 已离开边界
  });

  it('圆柱缸内连续游动始终不超出径向半径', () => {
    const start = createMotionState('zebra', fixedRand, cylinderBounds);
    const after = runMany(start, 'zebra', 300, 1, cylinderBounds);
    expect(Math.hypot(after.x, after.z)).toBeLessThanOrEqual(cylinderBounds.halfX + 1e-9);
  });

  it('圆柱缸初始位置落在圆内', () => {
    const state = createMotionState('guppy', fixedRand, cylinderBounds);
    expect(Math.hypot(state.x, state.z)).toBeLessThanOrEqual(cylinderBounds.halfX);
  });

  it('不同鱼种水层与垂直幅度不同', () => {
    expect(FISH_MOTION_CONFIG.guppy.waterLevel).toBe('top');
    expect(FISH_MOTION_CONFIG.guppy.centerY).toBeGreaterThan(FISH_MOTION_CONFIG.neon.centerY);
    expect(FISH_MOTION_CONFIG.angelfish.yRange).toBeGreaterThan(FISH_MOTION_CONFIG.neon.yRange);
  });

  it('behaviorSpeed 越大单位时间位移越远', () => {
    const base = createMotionState('guppy', fixedRand);
    const slow = runMany(base, 'guppy', 10, 0.3);
    const fast = runMany(base, 'guppy', 10, 2.2);
    const dist = (s: MotionState) => Math.hypot(s.x - base.x, s.z - base.z);
    expect(dist(fast)).toBeGreaterThan(dist(slow));
  });

  it('游动后位置相对起点发生变化', () => {
    const base = createMotionState('molly', fixedRand);
    const after = runMany(base, 'molly', 20);
    expect(
      Math.abs(after.x - base.x) + Math.abs(after.z - base.z) + Math.abs(after.y - base.y),
    ).toBeGreaterThan(0);
  });
});
