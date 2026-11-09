import * as THREE from 'three';
import type { Snapshot } from '../engine/core/types';
import { loadModel } from './ModelLoader';
import { IconRenderer } from './IconRenderer';
import { CameraController } from './CameraController';
import { PerformanceMonitor, QUALITY_PRESET, tierFromFps, type QualityTier } from './PerformanceMonitor';
import { createMotionState, updateMotion, type MotionState, type MotionBounds } from './fishMotion';
import { getRareVariant, COMMON_VARIANT } from '../engine/biology/variants';
import { getEnvironment, DEFAULT_ENVIRONMENT, type EnvironmentConfig } from '../engine/balance/environments';
import { getTankShape, DEFAULT_TANK_SHAPE, type TankShapeSpec } from '../engine/balance/tankShapes';
import { PLANT_CATALOG, EQUIPMENT_CATALOG } from '../engine/balance/catalog';

const FISH_COLORS = [0xff7043, 0x66bb6a, 0xffca28, 0x42a5f5, 0xab47bc, 0xef5350, 0x26c6da, 0xffa726];
const PLANT_GREENS = [0x4caf50, 0x66bb6a, 0x388e3c];

// M2 渲染：鱼群随引擎快照动态增减，支持 glTF 模型替换低模占位，失败降级
export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private fishMeshes = new Map<string, THREE.Object3D>();
  private fishMotion = new Map<string, MotionState>();
  private plantMeshes = new Map<string, THREE.Object3D>();
  private fishTemplate: THREE.Object3D | null = null;
  // 按鱼种 specId 存放 glb 模板，加载后 createFishMesh 按鱼种克隆
  private fishTemplates = new Map<string, THREE.Object3D>();
  // 按水草 specId 存放 glb 模板（模型几何已归一化到高度 1、原点在底部）
  private plantTemplates = new Map<string, THREE.Object3D>();
  // 按装备 specId 存放 glb 模板（归一化高度 1、原点在底部）
  private equipmentTemplates = new Map<string, THREE.Object3D>();
  // 离屏图标渲染器与商品缩略图缓存（specId -> PNG dataURL）
  private iconRenderer: IconRenderer | null = null;
  private iconCache = new Map<string, string>();
  // 程序化地板木纹（只创建一次，环境切换复用）
  private floorTexture: THREE.Texture | null = null;
  // 已安装装备的实体（type 之外按 specId 去重）与上次的安装签名
  private equipmentMeshes = new Map<string, THREE.Object3D>();
  private equipmentSignature = '';
  // CO2 是否已装：决定气泡从细化器（右后侧）成股冒出，而非全缸随机
  private co2Installed = false;
  // 各水草成熟时的目标视觉高度；幼苗到成熟按 size/maxSize 比例缩放
  // 数值已按缸内水体高度（约 3 单位）上调，让水草成为缸内主要景观而非点缀
  private plantMatureHeight: Record<string, number> = {
    'plant-anubias': 1.6,
    'plant-hornwort': 2.6,
    'plant-moss': 1.05,
  };
  private lastSnapshot: Snapshot | null = null;
  private monitor = new PerformanceMonitor();
  private quality: QualityTier = 'high';
  private raf = 0;
  private isDisposed = false;
  private container: HTMLElement;
  // 气泡与水面光影：让水体有"活"的呼吸感
  private bubbleTexture: THREE.Texture;
  private bubbles: THREE.Points | null = null;
  private bubbleSpeeds = new Float32Array(0);
  private bubbleCount = 0;
  private lightShaft: THREE.Mesh | null = null;
  private shaftTexture!: THREE.Texture;
  // 灯具实体：灯盘、支架与发光面，让光束有真实来源；currentLightOn 缓存避免每帧重复设置
  private lampGroup: THREE.Group | null = null;
  private lampGlowMat!: THREE.MeshStandardMaterial;
  private currentLightOn: boolean | null = null;
  // 放置环境组：背景墙、柜/桌面、窗户
  private environmentGroup: THREE.Group | null = null;
  // 背景纹理：加载器与按环境缓存，避免切换时重复加载
  private textureLoader = new THREE.TextureLoader();
  private backgroundTextures = new Map<string, THREE.Texture>();
  // 缸体组：玻璃、水、底砂，随形状重建
  private tankGroup: THREE.Group | null = null;
  private shapeSpec: TankShapeSpec;
  private motionBounds: MotionBounds;
  private prevElapsed = 0;
  private cameraController: CameraController;
  private detachCamera: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
    this.camera.position.set(0, 2.8, 10);
    this.camera.lookAt(0, 0, 0);

    // 清透海洋：场景本身用柔和浅青背景，而非黑色
    this.scene.background = new THREE.Color(0xd6ecf4);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(4, 8, 5);
    this.scene.add(keyLight);

    // 缸体（玻璃、水、底砂）按形状参数生成，默认长方缸
    this.shapeSpec = getTankShape(DEFAULT_TANK_SHAPE);
    this.motionBounds = this.toMotionBounds(this.shapeSpec);
    this.buildTank(this.shapeSpec);

    // 气泡与柔和水面光束
    this.bubbleTexture = this.makeBubbleTexture();
    this.createBubbles(40);
    this.createLightShaft();

    // 视角拖拽与缩放，绑定到 canvas
    this.cameraController = new CameraController(this.camera);
    this.detachCamera = this.cameraController.attach(this.renderer.domElement);

    // 默认放置环境（书房桌面）
    this.applyEnvironment(DEFAULT_ENVIRONMENT);
  }

  // 程序化生成圆形气泡纹理：中心亮、边缘柔，避免 Points 默认方形
  private makeBubbleTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  // 创建/重建指定数量的上升气泡，位置限定在缸内水体
  private createBubbles(count: number): void {
    if (this.bubbles) {
      this.scene.remove(this.bubbles);
      this.bubbles.geometry.dispose();
      (this.bubbles.material as THREE.Material).dispose();
    }
    this.bubbleCount = count;
    const positions = new Float32Array(count * 3);
    this.bubbleSpeeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let x: number;
      let z: number;
      if (this.motionBounds.kind === 'cylinder') {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * this.motionBounds.halfX;
        x = r * Math.cos(a);
        z = r * Math.sin(a);
      } else {
        x = (Math.random() - 0.5) * 2 * this.motionBounds.halfX;
        z = (Math.random() - 0.5) * 2 * this.motionBounds.halfZ;
      }
      positions[i * 3] = x;
      positions[i * 3 + 1] = -1.6 + Math.random() * 3.0;
      positions[i * 3 + 2] = z;
      this.bubbleSpeeds[i] = 0.3 + Math.random() * 0.5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      size: 0.13,
      map: this.bubbleTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    });
    this.bubbles = new THREE.Points(geometry, material);
    this.scene.add(this.bubbles);
  }

  // 生成光束渐变纹理：垂直方向从顶部柔和、向下渐隐到 0（消除底部硬边），
  // 水平方向两侧淡出（柔化圆柱环绕接缝）
  private makeShaftTexture(): THREE.Texture {
    const w = 64;
    const h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const vertical = ctx.createLinearGradient(0, 0, 0, h);
    vertical.addColorStop(0, 'rgba(255,255,255,0.95)');
    vertical.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    vertical.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = vertical;
    ctx.fillRect(0, 0, w, h);
    // 用 destination-in 叠加水平遮罩，让两侧自然淡出
    ctx.globalCompositeOperation = 'destination-in';
    const horizontal = ctx.createLinearGradient(0, 0, w, 0);
    horizontal.addColorStop(0, 'rgba(0,0,0,0)');
    horizontal.addColorStop(0.5, 'rgba(0,0,0,1)');
    horizontal.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = horizontal;
    ctx.fillRect(0, 0, w, h);
    return new THREE.CanvasTexture(canvas);
  }

  // 灯具实体 + 光束：缸上方支架式灯盘，光束从灯盘向下发出，随灯光开关联动
  private createLightShaft(): void {
    this.shaftTexture = this.makeShaftTexture();
    const lampGroup = new THREE.Group();

    // 缸口横向/纵向尺寸：box 用 width/depth，cylinder 用直径；灯具按比例适配，不伸出缸外
    const isCyl = this.shapeSpec.kind === 'cylinder';
    const tankW = isCyl ? this.shapeSpec.radius * 2 : this.shapeSpec.width;
    const tankD = isCyl ? this.shapeSpec.radius * 2 : this.shapeSpec.depth;
    const lampW = tankW * 0.78;
    const lampD = tankD * 0.62;
    const postX = tankW * 0.45;

    // 灯盘外壳：深色扁平盒，位于缸正上方
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x2a414e, roughness: 0.5, metalness: 0.2 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(lampW, 0.2, lampD), shellMat);
    shell.position.y = 1.95;
    lampGroup.add(shell);
    // 灯盘底面发光板：开灯时自发光，关灯时变暗
    this.lampGlowMat = new THREE.MeshStandardMaterial({
      color: 0xeaf6fb, emissive: 0xbfe6f5, emissiveIntensity: 1.2, roughness: 0.4,
    });
    const glow = new THREE.Mesh(new THREE.BoxGeometry(lampW * 0.92, 0.05, lampD * 0.82), this.lampGlowMat);
    glow.position.y = 1.83;
    lampGroup.add(glow);

    // 两侧立柱与底座：从底柜台面撑起灯盘
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2f5d70, roughness: 0.5, metalness: 0.3 });
    for (const sx of [-postX, postX]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.1, 0.14), postMat);
      post.position.set(sx, 0, 0);
      lampGroup.add(post);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), postMat);
      foot.position.set(sx, -2.05, 0);
      lampGroup.add(foot);
    }

    // 光束：从灯盘下方发出，顶部对齐灯盘，底部自然淡出；尺寸随灯盘比例，轻微倾斜让边缘可辨
    const material = new THREE.MeshBasicMaterial({
      map: this.shaftTexture,
      color: 0x8fc4dd, // 带实际色相的青，配合透明渐变，在浅色背景上柔和可见
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    this.lightShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(lampW * 0.12, lampW * 0.28, 3.6, 24, 1, true), material,
    );
    this.lightShaft.position.set(0, 0.05, 0);
    this.lightShaft.rotation.z = 0.05;
    this.lightShaft.renderOrder = 3;
    lampGroup.add(this.lightShaft);

    this.lampGroup = lampGroup;
    this.scene.add(lampGroup);
  }

  // 根据快照联动灯具与光束：关灯隐藏光束、灯盘变暗；开灯恢复
  private applyLightState(on: boolean): void {
    if (this.currentLightOn === on) return;
    this.currentLightOn = on;
    if (this.lightShaft) this.lightShaft.visible = on;
    if (this.lampGlowMat) {
      this.lampGlowMat.emissiveIntensity = on ? 1.2 : 0.04;
      this.lampGlowMat.color.setHex(on ? 0xeaf6fb : 0x5a6b75);
    }
  }

  // 取（或首次加载）环境背景纹理；view 缺省取正面图，否则取 `${id}_${view}.jpg`
  private getBackgroundTexture(id: string, view?: 'left' | 'right' | 'back'): THREE.Texture {
    const key = view ? `${id}_${view}` : id;
    const cached = this.backgroundTextures.get(key);
    if (cached) return cached;
    const file = view ? `${id}_${view}.jpg` : `${id}.jpg`;
    const texture = this.textureLoader.load(`/backgrounds/${file}`);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.backgroundTextures.set(key, texture);
    return texture;
  }

  // 切换放置环境：重建背景墙与柜/台面，并更新场景背景色
  applyEnvironment(environmentId: string): void {
    const config: EnvironmentConfig = getEnvironment(environmentId);
    if (this.environmentGroup) {
      this.scene.remove(this.environmentGroup);
      this.environmentGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        // 只释放材质与几何；背景纹理在 backgroundTextures 中缓存，不在此释放
        if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
      });
    }
    this.scene.background = new THREE.Color(config.background);

    const group = new THREE.Group();

    // 四面墙房间：相机 360° 环绕时每面都有写实背景，纹理加载期间透出 wallColor 兜底
    const HALF_W = 14;
    const HALF_D = 14;
    const WALL_H = 12;
    const WALL_Y = 1;
    const makeWall = (
      width: number,
      view: undefined | 'left' | 'right' | 'back',
      pos: [number, number, number],
      rotY: number,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(width, WALL_H),
        new THREE.MeshStandardMaterial({
          color: config.wallColor,
          map: this.getBackgroundTexture(config.id, view),
          roughness: 1,
        }),
      );
      m.position.set(...pos);
      m.rotation.y = rotY;
      return m;
    };
    // 后墙（正面图）、前墙（回头图）、左右墙；平面默认朝 +z，按位置旋转朝向房间内
    group.add(makeWall(HALF_W * 2, undefined, [0, WALL_Y, -HALF_D], 0));
    group.add(makeWall(HALF_W * 2, 'back', [0, WALL_Y, HALF_D], Math.PI));
    group.add(makeWall(HALF_D * 2, 'left', [-HALF_W, WALL_Y, 0], Math.PI / 2));
    group.add(makeWall(HALF_D * 2, 'right', [HALF_W, WALL_Y, 0], -Math.PI / 2));
    // 地板与天花板：防止俯仰到极限时看到房间外；地板用程序化木纹，避免侧后视角看到大片纯色
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, map: this.getFloorTexture() }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = WALL_Y - WALL_H / 2;
    group.add(floor);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2),
      new THREE.MeshStandardMaterial({ color: 0xe8eef1, roughness: 1 }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_Y + WALL_H / 2;
    group.add(ceiling);

    // 鱼缸底柜：统一深色（与缸框同色系），作为鱼缸专用支架，不随环境变色，避免与背景图家具冲突
    const cabinet = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 2, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x35505f, roughness: 0.7, metalness: 0.1 }),
    );
    cabinet.position.set(0, -3.1, 0);
    group.add(cabinet);
    // 底柜顶部薄台面：略深，承托缸体
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(7.4, 0.12, 3.4),
      new THREE.MeshStandardMaterial({ color: 0x2a414e, roughness: 0.6, metalness: 0.2 }),
    );
    counter.position.set(0, -2.05, 0);
    group.add(counter);
    this.environmentGroup = group;
    this.scene.add(group);
  }

  // 释放一个组内全部 geometry/material
  private disposeGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
    });
  }

  private toMotionBounds(spec: TankShapeSpec): MotionBounds {
    return {
      kind: spec.kind,
      yMin: spec.motion.yMin, yMax: spec.motion.yMax,
      halfX: spec.motion.halfX, halfZ: spec.motion.halfZ,
    };
  }

  // 程序化浅木地板纹理：木条 + 细纹，零外部资源，按房间尺寸平铺
  private getFloorTexture(): THREE.Texture {
    if (this.floorTexture) return this.floorTexture;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ab9d8c';
    ctx.fillRect(0, 0, 256, 256);
    const plankH = 32;
    for (let row = 0; row < 256 / plankH; row++) {
      const y = row * plankH;
      const tone = 176 + (row % 3) * 7;
      ctx.fillStyle = `rgb(${tone}, ${tone - 14}, ${tone - 34})`;
      ctx.fillRect(0, y + 1, 256, plankH - 2);
      // 木条接缝
      ctx.fillStyle = 'rgba(120, 96, 74, 0.30)';
      ctx.fillRect(0, y, 256, 1);
      // 逐条细木纹，长度错开，避免像规则条纹
      for (let i = 0; i < 22; i++) {
        const ly = y + 3 + Math.random() * (plankH - 6);
        const lx = Math.random() * 256;
        const len = 30 + Math.random() * 110;
        ctx.strokeStyle = `rgba(146, 116, 88, ${0.08 + Math.random() * 0.10})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + len, ly + (Math.random() - 0.5) * 1.6);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.floorTexture = tex;
    return tex;
  }

  // 按形状生成缸玻璃、水、底砂
  private buildTank(spec: TankShapeSpec): void {
    const group = new THREE.Group();
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xbfe8f5, transparent: true, opacity: 0.16, metalness: 0.1, roughness: 0.15,
      side: THREE.DoubleSide, depthWrite: false, // 透明玻璃不写深度，避免剔除缸内光束等内部物体
    });
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x57a8d0, transparent: true, opacity: 0.32, depthWrite: false,
    });
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xd8c49a });
    // 真实缸体的上下包边：深色细实体框，有厚度，替代不真实的线框
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2f5d70, roughness: 0.5, metalness: 0.3 });

    if (spec.kind === 'box') {
      const { width, depth, height } = spec;
      group.add(new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), glassMat));
      // 上下两圈实体包边
      this.addBoxFrame(group, width, depth, height, frameMat);
      const waterMesh = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 3.2, depth - 0.2), waterMat);
      waterMesh.position.y = -0.2;
      group.add(waterMesh);
      const sandMesh = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.35, depth - 0.2), sandMat);
      sandMesh.position.y = -1.75;
      group.add(sandMesh);
    } else {
      const { radius, height } = spec;
      // 开放侧壁 + 底部
      group.add(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 48, 1, true), glassMat));
      group.add(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.1, 48), glassMat));
      // 上下两个实体圆环包边
      const topRing = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 10, 64), frameMat);
      topRing.rotation.x = Math.PI / 2;
      topRing.position.y = height / 2;
      group.add(topRing);
      const bottomRing = topRing.clone();
      bottomRing.position.y = -height / 2;
      group.add(bottomRing);
      const waterMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.95, radius * 0.95, 3.2, 48), waterMat);
      waterMesh.position.y = -0.2;
      group.add(waterMesh);
      const sandMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.95, radius * 0.95, 0.35, 48), sandMat);
      sandMesh.position.y = -1.75;
      group.add(sandMesh);
    }

    this.tankGroup = group;
    this.scene.add(group);
  }

  // 给 box 缸加上下两圈实体包边（每圈 4 条细长方体）
  private addBoxFrame(
    group: THREE.Group, width: number, depth: number, height: number, mat: THREE.Material,
  ): void {
    const t = 0.06;
    const make = (w: number, d: number, x: number, z: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), mat);
      m.position.set(x, y, z);
      group.add(m);
    };
    for (const y of [height / 2, -height / 2]) {
      make(width + t, t, 0, depth / 2, y);
      make(width + t, t, 0, -depth / 2, y);
      make(t, depth + t, width / 2, 0, y);
      make(t, depth + t, -width / 2, 0, y);
    }
  }

  // 切换鱼缸形状：重建缸体，更新游动边界，气泡按新边界重建
  applyTankShape(shapeId: string): void {
    const spec = getTankShape(shapeId);
    if (this.tankGroup) {
      this.scene.remove(this.tankGroup);
      this.disposeGroup(this.tankGroup);
    }
    this.shapeSpec = spec;
    this.motionBounds = this.toMotionBounds(spec);
    this.buildTank(spec);
    // 气泡与水草按新边界重建
    const bubbleCounts: Record<string, number> = { high: 40, medium: 24, low: 12 };
    this.createBubbles(bubbleCounts[this.quality]);
    this.relayoutPlants();
    // 灯具按新形状尺寸重建，并恢复当前开关状态
    const wasLightOn = this.currentLightOn;
    if (this.lampGroup) {
      this.scene.remove(this.lampGroup);
      this.disposeGroup(this.lampGroup);
    }
    this.currentLightOn = null; // 重置缓存，让重建后的 applyLightState 重新生效
    this.createLightShaft();
    if (wasLightOn !== null) this.applyLightState(wasLightOn);
  }

  // 释放一条鱼（占位 Mesh 或 glTF Group）占用的 GPU 资源
  private disposeFishObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((m) => m.dispose());
      }
    });
  }

  // 给 glb 模型做稀有品系着色：克隆材质并替换颜色，保留模型形状
  private applyVariantTint(obj: THREE.Object3D, color: number): void {
    const tint = new THREE.Color(color);
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = mats.map((m) => {
        const cloned = m.clone() as THREE.MeshStandardMaterial;
        if (cloned.color) cloned.color.copy(tint);
        return cloned;
      });
    });
  }

  // 造一条鱼：优先按鱼种 glb 模板克隆，其次单模板，否则锥体占位；稀有品系用专属颜色
  private createFishMesh(i: number, specId: string, variant: string): THREE.Object3D {
    const rare = variant === COMMON_VARIANT ? undefined : getRareVariant(specId, variant);
    const typed = this.fishTemplates.get(specId);
    if (typed) {
      const obj = typed.clone(true);
      if (rare) this.applyVariantTint(obj, rare.color);
      return obj;
    }
    if (this.fishTemplate) {
      const obj = this.fishTemplate.clone(true);
      if (rare) this.applyVariantTint(obj, rare.color);
      return obj;
    }
    const color = rare ? rare.color : FISH_COLORS[i % FISH_COLORS.length];
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.6, 8),
      new THREE.MeshStandardMaterial({ color }),
    );
    mesh.rotation.z = Math.PI / 2;
    return mesh;
  }

  private syncFish(snapshot: Snapshot): void {
    const liveIds = new Set(snapshot.fishes.map((f) => f.id));
    // 移除已不存在的鱼
    for (const [id, mesh] of this.fishMeshes) {
      if (!liveIds.has(id)) {
        this.scene.remove(mesh);
        this.disposeFishObject(mesh);
        this.fishMeshes.delete(id);
        this.fishMotion.delete(id);
      }
    }
    // 新增鱼
    snapshot.fishes.forEach((f, i) => {
      if (!this.fishMeshes.has(f.id)) {
        const mesh = this.createFishMesh(i, f.specId, f.variant);
        this.scene.add(mesh);
        this.fishMeshes.set(f.id, mesh);
        this.fishMotion.set(f.id, createMotionState(f.specId, Math.random, this.motionBounds));
      }
    });
  }

  // 造一株水草：优先按 specId 克隆 glb 模板，否则回退圆锥占位
  // glb 与占位的几何原点都在底部，使缩放（生长）时从砂面向上长
  private createPlantMesh(specId: string, fallbackIndex: number): THREE.Object3D {
    const template = this.plantTemplates.get(specId);
    if (template) return template.clone(true);
    const geometry = new THREE.ConeGeometry(0.12, 0.8, 6);
    geometry.translate(0, 0.4, 0);
    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: PLANT_GREENS[fallbackIndex % PLANT_GREENS.length],
        roughness: 0.8,
      }),
    );
  }

  private syncPlant(snapshot: Snapshot): void {
    const liveIds = new Set(snapshot.plants.map((p) => p.id));
    for (const [id, mesh] of this.plantMeshes) {
      if (!liveIds.has(id)) {
        this.scene.remove(mesh);
        this.disposeFishObject(mesh);
        this.plantMeshes.delete(id);
      }
    }
    snapshot.plants.forEach((plant, i) => {
      if (!this.plantMeshes.has(plant.id)) {
        const mesh = this.createPlantMesh(plant.specId, i);
        // 稳定分布在砂面，避免多株重叠
        const pos = this.plantPosition(i);
        mesh.position.set(pos.x, -1.55, pos.z);
        this.scene.add(mesh);
        this.plantMeshes.set(plant.id, mesh);
      }
    });
  }

  // 按当前形状计算第 i 株水草的砂面位置，稳定且尽量不重叠
  private plantPosition(i: number): { x: number; z: number } {
    if (this.motionBounds.kind === 'cylinder') {
      // 圆内螺旋分布
      const angle = i * 2.4;
      const r = Math.min(this.motionBounds.halfX * 0.8, 0.3 + (i % 3) * 0.5);
      return { x: r * Math.cos(angle), z: r * Math.sin(angle) };
    }
    const cols = 3;
    const stepX = Math.max(0.8, (2 * this.motionBounds.halfX - 0.6) / cols);
    const stepZ = 1.0;
    const x = -this.motionBounds.halfX + 0.3 + (i % cols) * stepX;
    const z = -this.motionBounds.halfZ + 0.3 + Math.floor(i / cols) * stepZ;
    return { x, z };
  }

  // 切换形状后对现有水草重新布局
  private relayoutPlants(): void {
    let i = 0;
    for (const mesh of this.plantMeshes.values()) {
      const pos = this.plantPosition(i);
      mesh.position.set(pos.x, -1.55, pos.z);
      i++;
    }
  }

  // 用当前模板重建现有鱼 mesh；运动状态独立保留，不受换模影响
  private rebuildFishMeshes(): void {
    for (const [id, old] of this.fishMeshes) {
      this.scene.remove(old);
      this.disposeFishObject(old);
      const index = this.lastSnapshot?.fishes.findIndex((f) => f.id === id) ?? 0;
      const fish = this.lastSnapshot?.fishes[index];
      const fresh = this.createFishMesh(
        Math.max(0, index),
        fish?.specId ?? '',
        fish?.variant ?? COMMON_VARIANT,
      );
      // 立即从保留的运动状态恢复位置与朝向，避免首帧前重叠在原点
      const motion = this.fishMotion.get(id);
      if (motion) {
        fresh.position.set(motion.x, motion.y, motion.z);
        fresh.rotation.y = motion.heading;
      }
      this.scene.add(fresh);
      this.fishMeshes.set(id, fresh);
    }
  }

  // 批量按鱼种加载 glb 模板；单个失败不影响其他，加载完重建现有鱼
  async loadFishModels(specIds: string[]): Promise<{ loaded: string[]; failed: string[] }> {
    const loaded: string[] = [];
    const failed: string[] = [];
    await Promise.all(
      specIds.map(async (specId) => {
        if (this.fishTemplates.has(specId)) {
          loaded.push(specId);
          return;
        }
        try {
          const result = await loadModel(`/models/fish/${specId}.glb`);
          if (this.isDisposed) return;
          this.fishTemplates.set(specId, result.group);
          loaded.push(specId);
        } catch {
          failed.push(specId);
        }
      }),
    );
    if (!this.isDisposed) this.rebuildFishMeshes();
    return { loaded: loaded.sort(), failed: failed.sort() };
  }

  // 批量按水草 specId 加载 glb 模板；单个失败不影响其他，加载完重建现有水草
  async loadPlantModels(specIds: string[]): Promise<{ loaded: string[]; failed: string[] }> {
    const loaded: string[] = [];
    const failed: string[] = [];
    await Promise.all(
      specIds.map(async (specId) => {
        if (this.plantTemplates.has(specId)) {
          loaded.push(specId);
          return;
        }
        try {
          const short = specId.replace(/^plant-/, '');
          const result = await loadModel(`/models/plants/${short}.glb`);
          if (this.isDisposed) return;
          this.plantTemplates.set(specId, result.group);
          loaded.push(specId);
        } catch {
          failed.push(specId);
        }
      }),
    );
    if (!this.isDisposed) this.rebuildPlantMeshes();
    return { loaded: loaded.sort(), failed: failed.sort() };
  }

  // 批量按装备 specId 加载 glb 模板；装备不进场景，仅作商店图标与后续缸内摆放的来源
  async loadEquipmentModels(specIds: string[]): Promise<{ loaded: string[]; failed: string[] }> {
    const loaded: string[] = [];
    const failed: string[] = [];
    await Promise.all(
      specIds.map(async (specId) => {
        if (this.equipmentTemplates.has(specId)) {
          loaded.push(specId);
          return;
        }
        try {
          const result = await loadModel(`/models/equipment/${specId}.glb`);
          if (this.isDisposed) return;
          this.equipmentTemplates.set(specId, result.group);
          loaded.push(specId);
        } catch {
          failed.push(specId);
        }
      }),
    );
    // 装备模型就绪后补摆一次已安装装备（update 的签名比对不会因模板后到而重跑）
    if (!this.isDisposed && this.lastSnapshot) {
      this.equipmentSignature = '';
      this.syncEquipment(this.lastSnapshot);
      this.equipmentSignature = Object.values(this.lastSnapshot.installed).join('|');
    }
    return { loaded: loaded.sort(), failed: failed.sort() };
  }

  // 为全部已加载模型离屏渲染商品缩略图，返回 specId -> dataURL；礼遇等无模型项不在此处理
  async buildShopIcons(): Promise<Record<string, string>> {
    if (this.isDisposed) return {};
    if (!this.iconRenderer) this.iconRenderer = new IconRenderer(256);
    const renderInto = (map: Map<string, THREE.Object3D>): void => {
      map.forEach((tpl, specId) => {
        if (!this.iconCache.has(specId)) {
          this.iconCache.set(specId, this.iconRenderer!.renderIcon(tpl));
        }
      });
    };
    renderInto(this.fishTemplates);
    renderInto(this.plantTemplates);
    renderInto(this.equipmentTemplates);
    return Object.fromEntries(this.iconCache);
  }

  // 已安装装备的缸内/缸外实体：按类型定锚点，模型复用商店同一套 glb；
  // 灯光类由既有灯盘与光束承担，不重复摆放
  private syncEquipment(snapshot: Snapshot): void {
    const specById = new Map(EQUIPMENT_CATALOG.map((e) => [e.id, e]));
    const wanted = new Map<string, string>(); // specId -> type
    Object.values(snapshot.installed).forEach((specId) => {
      const spec = specById.get(specId);
      if (spec && spec.type !== 'light') wanted.set(specId, spec.type);
    });
    this.co2Installed = [...wanted.values()].includes('co2');
    for (const [specId, mesh] of this.equipmentMeshes) {
      if (!wanted.has(specId)) {
        this.scene.remove(mesh);
        this.disposeFishObject(mesh);
        this.equipmentMeshes.delete(specId);
      }
    }
    for (const [specId, type] of wanted) {
      if (this.equipmentMeshes.has(specId)) continue;
      const template = this.equipmentTemplates.get(specId);
      if (!template) continue;
      const mesh = template.clone(true);
      const a = this.equipmentAnchor(type, specId);
      mesh.position.set(a.x, a.y, a.z);
      mesh.scale.setScalar(a.scale);
      mesh.rotation.y = a.rotY;
      this.scene.add(mesh);
      this.equipmentMeshes.set(specId, mesh);
    }
  }

  // 装备摆放锚点：加热棒在缸内后侧、壁挂过滤贴左侧内壁、外置滤桶与 CO2 在缸外
  private equipmentAnchor(
    type: string,
    specId: string,
  ): { x: number; y: number; z: number; scale: number; rotY: number } {
    const hx = this.motionBounds.halfX;
    const hz = this.motionBounds.halfZ;
    if (type === 'heater') {
      return { x: hx * 0.74, y: -1.55, z: -hz * 0.66, scale: 1.0, rotY: 0 };
    }
    if (type === 'filter') {
      if (specId === 'filter-canister') {
        // 外置滤桶：缸外左侧落地
        return { x: -(hx + 1.15), y: -5, z: 0.2, scale: 1.0, rotY: 0.25 };
      }
      if (specId === 'filter-sump') {
        // 底滤槽：底柜前缘地面，正视图能看见
        return { x: 0, y: -5, z: 1.72, scale: 0.85, rotY: 0 };
      }
      // 壁挂过滤：挂在后壁偏右，正面朝观众，形态一眼可辨
      return { x: hx * 0.5, y: -0.55, z: -hz * 0.92, scale: 1.0, rotY: 0 };
    }
    if (type === 'co2') {
      // CO2 钢瓶：台面上缸体右侧
      return { x: hx + 0.95, y: -2.04, z: 0.1, scale: 1.05, rotY: -0.3 };
    }
    return { x: 0, y: -2.04, z: 0, scale: 1, rotY: 0 };
  }

  // 用当前模板重建现有水草，保留砂面位置
  private rebuildPlantMeshes(): void {
    for (const [, old] of this.plantMeshes) {
      this.scene.remove(old);
      this.disposeFishObject(old);
    }
    this.plantMeshes.clear();
    const plants = this.lastSnapshot?.plants ?? [];
    plants.forEach((plant, idx) => {
      const mesh = this.createPlantMesh(plant.specId, idx);
      const pos = this.plantPosition(idx);
      mesh.position.set(pos.x, -1.55, pos.z);
      this.scene.add(mesh);
      this.plantMeshes.set(plant.id, mesh);
    });
  }

  // 加载单个 glTF 资产并替换全部现有鱼（单模板，向后兼容）；失败保留占位并返回原因
  async setFishAsset(url: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      const loaded = await loadModel(url);
      // 加载期间渲染器可能已被卸载（路由切换/StrictMode），放弃后续操作
      if (this.isDisposed) return { ok: false, reason: 'renderer disposed' };
      this.fishTemplate = loaded.group;
      this.rebuildFishMeshes();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  update(snapshot: Snapshot, elapsed: number): void {
    this.lastSnapshot = snapshot;
    // 灯具与光束随灯光开关联动
    this.applyLightState(snapshot.lightOn);
    this.syncFish(snapshot);
    this.syncPlant(snapshot);
    // 已装装备变化时才重建实体，避免每帧遍历
    const equipSig = Object.values(snapshot.installed).join('|');
    if (equipSig !== this.equipmentSignature) {
      this.equipmentSignature = equipSig;
      this.syncEquipment(snapshot);
    }
    // 帧间隔（秒），用于气泡等与帧率无关的运动
    const dt = Math.min(0.05, Math.max(0, (elapsed - this.prevElapsed) / 1000));
    this.prevElapsed = elapsed;
    const speedByBehavior = { normal: 1, anxious: 2.2, hiding: 0.3, sick: 0.5 };
    const timeSeconds = elapsed / 1000;
    snapshot.fishes.forEach((f) => {
      const mesh = this.fishMeshes.get(f.id)!;
      const next = updateMotion({
        state: this.fishMotion.get(f.id)!,
        specId: f.specId,
        behaviorSpeed: speedByBehavior[f.behavior],
        dt,
        time: timeSeconds,
        rand: Math.random,
        bounds: this.motionBounds,
      });
      this.fishMotion.set(f.id, next);
      mesh.position.set(next.x, next.y, next.z);
      mesh.rotation.y = next.heading;
    });
    // 水草随引擎 size 缩放，体现生长：幼苗到成熟按 size/maxSize 比例，再乘成熟视觉高度
    // 视觉比例做下限重映射（幼苗 0.2 → 视觉 0.66），新种下就能看清，成熟后仍是明显长大
    snapshot.plants.forEach((p) => {
      const mesh = this.plantMeshes.get(p.id);
      if (!mesh) return;
      const spec = PLANT_CATALOG.find((c) => c.id === p.specId);
      const matureHeight = this.plantMatureHeight[p.specId] ?? 1;
      const growRatio = spec ? p.size / spec.maxSize : p.size;
      const visualRatio = 0.66 + 0.34 * Math.max(0, Math.min(1, (growRatio - 0.2) / 0.8));
      mesh.scale.setScalar(visualRatio * matureHeight);
    });

    // 气泡匀速上升、轻微左右飘，到水面后从底部重新升起
    if (this.bubbles) {
      const attr = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.bubbleCount; i++) {
        const xIdx = i * 3;
        const yIdx = xIdx + 1;
        arr[yIdx] += this.bubbleSpeeds[i] * dt;
        arr[xIdx] += Math.sin(elapsed * 0.002 + i) * dt * 0.12;
        if (arr[yIdx] > 1.5) {
          arr[yIdx] = -1.6;
          if (this.co2Installed) {
            // CO2 细化器：右后侧砂面成股冒泡，小幅抖动模拟细化器气泡
            arr[xIdx] = this.motionBounds.halfX * 0.55 + (Math.random() - 0.5) * 0.35;
            arr[xIdx + 2] = -this.motionBounds.halfZ * 0.45 + (Math.random() - 0.5) * 0.3;
          } else if (this.motionBounds.kind === 'cylinder') {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * this.motionBounds.halfX;
            arr[xIdx] = r * Math.cos(a);
            arr[xIdx + 2] = r * Math.sin(a);
          } else {
            arr[xIdx] = (Math.random() - 0.5) * 2 * this.motionBounds.halfX;
            arr[xIdx + 2] = (Math.random() - 0.5) * 2 * this.motionBounds.halfZ;
          }
        }
      }
      attr.needsUpdate = true;
    }
    // 光束保持静止，避免旋转造成底部边缘闪烁

    this.cameraController.update(elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  start(onFrame: (dt: number) => void): void {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      onFrame(dt);
      // 采样 FPS，低于阈值自动降档（带滞后，避免频繁切换）
      if (this.monitor.sample(now)) {
        const next = tierFromFps(this.monitor.fps, this.quality);
        if (next !== this.quality) this.setQuality(next);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // 切换画质档位：调整像素比上限，低档降低渲染分辨率与气泡数量
  setQuality(tier: QualityTier): void {
    this.quality = tier;
    const preset = QUALITY_PRESET[tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio));
    const bubbleCounts: Record<QualityTier, number> = { high: 40, medium: 24, low: 12 };
    this.createBubbles(bubbleCounts[tier]);
    this.resize();
  }

  getQuality(): QualityTier {
    return this.quality;
  }

  getPerformance(): { fps: number; frameMs: number } {
    return { fps: this.monitor.fps, frameMs: this.monitor.frameMs };
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    this.isDisposed = true;
    this.detachCamera?.();
    this.detachCamera = null;
    cancelAnimationFrame(this.raf);
    // 遍历场景释放全部 geometry/material，覆盖缸体、水、底砂、鱼群、线框
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((m) => m.dispose());
      }
    });
    this.fishMeshes.clear();
    this.fishMotion.clear();
    this.plantMeshes.clear();
    this.equipmentMeshes.clear();
    this.equipmentSignature = '';
    // 模板未加入场景，traverse 不覆盖，需单独递归释放后清空
    this.fishTemplates.forEach((tpl) => this.disposeFishObject(tpl));
    this.fishTemplates.clear();
    this.fishTemplate = null;
    this.plantTemplates.forEach((tpl) => this.disposeFishObject(tpl));
    this.plantTemplates.clear();
    this.equipmentTemplates.forEach((tpl) => this.disposeFishObject(tpl));
    this.equipmentTemplates.clear();
    this.iconRenderer?.dispose();
    this.iconRenderer = null;
    this.iconCache.clear();
    this.environmentGroup = null;
    this.tankGroup = null;
    this.lampGroup = null;
    // 纹理被材质引用，需单独释放；背景纹理缓存统一释放
    this.bubbleTexture?.dispose();
    this.shaftTexture?.dispose();
    this.backgroundTextures.forEach((tex) => tex.dispose());
    this.backgroundTextures.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
