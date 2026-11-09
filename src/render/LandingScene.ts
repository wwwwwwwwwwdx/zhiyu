import * as THREE from 'three';

interface FishAgent {
  phase: number;
  speed: number;
  radius: number;
  yBase: number;
  zBase: number;
}

// 首页全屏背景：鱼群剪影 + 光束 + 浮游微粒，对应"鯈鱼出游从容"
export class LandingScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private instanced: THREE.InstancedMesh;
  private particles: THREE.Points;
  private agents: FishAgent[] = [];
  private raf = 0;
  private container: HTMLElement;
  private dummy = new THREE.Object3D();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 100);
    this.camera.position.set(0, 0, 10);

    this.scene.fog = new THREE.FogExp2(0x0e1722, 0.055);
    this.scene.add(new THREE.AmbientLight(0x6f8fb0, 0.8));
    const key = new THREE.DirectionalLight(0xbfd8ff, 1.0);
    key.position.set(3, 8, 4);
    this.scene.add(key);

    // 体积光束：半透明拉长锥体
    for (let i = 0; i < 4; i += 1) {
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(1.2 + i * 0.3, 14, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x9fc8e8, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      beam.position.set(-5 + i * 3.2, 3.5, -4 - i);
      this.scene.add(beam);
    }

    // 鱼群（实例化低模剪影）
    const count = 24;
    this.instanced = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.16, 0.7, 6),
      new THREE.MeshStandardMaterial({ color: 0x1c3a52, metalness: 0.3, roughness: 0.6, emissive: 0x0a1c2c }),
      count,
    );
    this.scene.add(this.instanced);

    for (let i = 0; i < count; i += 1) {
      this.agents.push({
        phase: Math.random() * Math.PI * 2,
        speed: 0.15 + Math.random() * 0.2,
        radius: 3 + Math.random() * 4.5,
        yBase: -2.5 + Math.random() * 5,
        zBase: -2 - Math.random() * 6,
      });
    }

    // 浮游微粒
    const positions = new Float32Array(220 * 3);
    for (let i = 0; i < positions.length; i += 1) {
      positions[i] = (Math.random() - 0.5) * 22;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particles = new THREE.Points(
      particleGeo,
      new THREE.PointsMaterial({ color: 0x9fc4e0, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.scene.add(this.particles);
  }

  start(): void {
    const clock = new THREE.Clock();
    const loop = () => {
      const t = clock.getElapsedTime();
      this.agents.forEach((a, i) => {
        const angle = t * a.speed + a.phase;
        this.dummy.position.set(
          Math.sin(angle) * a.radius,
          a.yBase + Math.sin(angle * 1.4) * 0.6,
          a.zBase + Math.cos(angle) * 1.2,
        );
        this.dummy.rotation.z = Math.PI / 2;
        this.dummy.rotation.y = -angle;
        this.dummy.updateMatrix();
        this.instanced.setMatrixAt(i, this.dummy.matrix);
      });
      this.instanced.instanceMatrix.needsUpdate = true;
      this.particles.rotation.y = t * 0.02;
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    // 遍历场景释放全部 geometry/material，覆盖光束、实例化鱼群、微粒
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((m) => m.dispose());
      }
    });
    this.agents = [];
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
