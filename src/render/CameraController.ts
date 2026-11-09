// 轻量相机控制：拖拽做球面轨道（可 360° 环绕）、滚轮缩放，松手后保留当前视角。
// 不依赖 OrbitControls，数值逻辑（drag/zoom）与 DOM 事件分离，便于单测。
import * as THREE from 'three';

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3(0, 0, 0);
  private radius: number;
  private azimuth: number;
  private polar: number;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  // 方位角不限制、可 360° 环绕；只限制俯仰角，避免翻转或看到房间外
  // POLAR_MIN=0.75（约 43° 俯角）：再低会从灯盘上方往下看，被灯盘挡住缸内
  private static POLAR_MIN = 0.75;
  private static POLAR_MAX = 1.45;
  private static RADIUS_MIN = 5;
  private static RADIUS_MAX = 14;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(this.target));
    this.radius = spherical.radius;
    this.azimuth = spherical.theta;
    this.polar = spherical.phi;
  }

  // 拖拽增量（像素），方位角自由累积、俯仰角限制范围
  drag(dx: number, dy: number): void {
    this.azimuth -= dx * 0.005;
    this.polar = THREE.MathUtils.clamp(
      this.polar - dy * 0.005,
      CameraController.POLAR_MIN,
      CameraController.POLAR_MAX,
    );
  }

  // 滚轮增量，限制缩放距离
  zoom(deltaY: number): void {
    this.radius = THREE.MathUtils.clamp(
      this.radius + deltaY * 0.01,
      CameraController.RADIUS_MIN,
      CameraController.RADIUS_MAX,
    );
  }

  // 绑定到交互元素，返回解绑函数
  attach(el: HTMLElement): () => void {
    const onDown = (e: PointerEvent) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.drag(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    const onUp = () => { this.dragging = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoom(e.deltaY);
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }

  update(_elapsed: number): void {
    // 始终以当前角度为准：拖拽实时更新，松手后保留用户转到的视角，不自动回正
    const spherical = new THREE.Spherical(this.radius, this.polar, this.azimuth);
    this.camera.position.setFromSpherical(spherical).add(this.target);
    this.camera.lookAt(this.target);
  }
}
