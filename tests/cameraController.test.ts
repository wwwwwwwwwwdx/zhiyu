import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../src/render/CameraController';

function makeController(): CameraController {
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 100);
  camera.position.set(6, 4, 8);
  return new CameraController(camera);
}

describe('CameraController', () => {
  it('方位角可自由 360° 环绕，俯仰角仍被限制在安全范围', () => {
    const controller = makeController();
    const before = (controller as unknown as { azimuth: number }).azimuth;
    for (let i = 0; i < 200; i++) controller.drag(1000, 1000);
    const s = controller as unknown as { azimuth: number; polar: number };
    // 方位角不再被夹在 ±0.6，大幅拖拽后明显超出旧限制，证明可环绕
    expect(Math.abs(s.azimuth - before)).toBeGreaterThan(0.6);
    expect(s.polar).toBeGreaterThanOrEqual(0.75 - 1e-9);
    expect(s.polar).toBeLessThanOrEqual(1.45 + 1e-9);
  });

  it('松手后视角保留：update 不把方位角拉回初始值', () => {
    const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 100);
    camera.position.set(0, 2.8, 10);
    const controller = new CameraController(camera);
    for (let i = 0; i < 50; i++) controller.drag(200, 0);
    const dragged = (controller as unknown as { azimuth: number }).azimuth;
    controller.update(100000);
    // update 后相机方位角应保持拖拽结果，而非回到初始
    const after = new THREE.Spherical().setFromVector3(camera.position);
    // Spherical.theta 归一化到 (-π, π]，与累积的 azimuth 相差整数个 2π，按圆周角差比较
    const twoPi = Math.PI * 2;
    const diff = Math.abs((((dragged - after.theta) % twoPi) + twoPi) % twoPi);
    expect(Math.min(diff, twoPi - diff)).toBeLessThan(1e-5);
  });

  it('反复滚轮缩放，半径被限制在最小与最大值之间', () => {
    const controller = makeController();
    for (let i = 0; i < 200; i++) controller.zoom(-1000);
    expect((controller as unknown as { radius: number }).radius).toBeGreaterThanOrEqual(5 - 1e-9);
    for (let i = 0; i < 200; i++) controller.zoom(1000);
    expect((controller as unknown as { radius: number }).radius).toBeLessThanOrEqual(14 + 1e-9);
  });
});
