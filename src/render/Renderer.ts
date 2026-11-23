import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Snapshot } from '../engine/core/types';
import { loadModel } from './ModelLoader';
import { IconRenderer } from './IconRenderer';
import { CameraController } from './CameraController';
import { PerformanceMonitor, QUALITY_PRESET, tierFromFps, type QualityTier } from './PerformanceMonitor';
import { createMotionState, updateMotion, temperOf, type MotionState, type MotionBounds, type FishTemper } from './fishMotion';
import { getRareVariant, COMMON_VARIANT } from '../engine/biology/variants';
import { getEnvironment, ENVIRONMENT_CATALOG, DEFAULT_ENVIRONMENT, type EnvironmentConfig } from '../engine/balance/environments';
import { getTankShape, DEFAULT_TANK_SHAPE, type TankShapeSpec } from '../engine/balance/tankShapes';
import { PLANT_CATALOG, EQUIPMENT_CATALOG } from '../engine/balance/catalog';
import { DEFAULT_SCENE_SKIN, getSkin, type SceneSkin } from './sceneSkin';

// 每条鱼独立的游泳画像。
// 模板 clone 会共享 geometry 与 material，所以这里的 uniform 必须挂在逐鱼克隆出的
// 材质上，否则整缸鱼共用一个相位，摆尾会完全同步。
//
// 相位（phaseUniform）是**累计量**：每帧 phase += freq * dt。
// 上一版用"时间 × 频率"在着色器里算相位，而频率是随游速变化的——
// 相位的一阶导就成了 freq + time·dfreq/dt，time 越大项越炸，
// 表现为"每隔几秒尾巴突然狂摆"，且页面开得越久越严重。这是本文件最重要的一个坑。
interface SwimProfile {
  phase: number; // 固定随机相位：错开各鱼的摆尾起点与胸鳍相位
  freq: number; // 角频率（弧度/秒），由个体实时游速驱动；只积分进相位，不再乘时间
  yaw: number; // 尾部最大偏转角（弧度）
  speed: number; // 平滑后的游速，单位/秒
  bodyLength: number; // 模型实际体长，偏转角按它换算横向摆幅
  phaseUniform: { value: number }; // 累计相位（初始值 = 随机相位），每帧 += freq*dt
  uniforms: {
    uSwimYaw: { value: number };
    uTurnBend: { value: number };
    uBodyMaxX: { value: number };
    uBodyInvLen: { value: number };
  };
  pecs: Array<{ obj: THREE.Object3D; baseY: number; side: number }>;
  temper: FishTemper; // 个体秉性（速度/转向/摆尾参数的个体差）
}

// M2 渲染：鱼群随引擎快照动态增减，支持 glTF 模型替换低模占位，失败降级
export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  // 场景皮肤：颜色、光照、水色全部从这里取，换风格只改 sceneSkin 里的对象
  private skin: SceneSkin = DEFAULT_SCENE_SKIN;
  // 换皮期间置位，挡掉连续点击造成的重复预载
  private themeSwitching = false;
  // 真正建完的皮肤（this.skin 在预载阶段就已指向目标皮，不能用来判断"是否已完成"）
  private appliedTheme: SceneSkin['id'] = DEFAULT_SCENE_SKIN.id;
  // 预载期间又被点了另一套皮：先记下来，等这次切完再切一次，避免 UI 与场景不一致
  private pendingTheme: SceneSkin['id'] | null = null;
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
  // 造景道具（岩石/沉木）模板与缸内实体组
  private propTemplates = new Map<string, THREE.Object3D>();
  private propGroup: THREE.Group | null = null;
  // 离屏图标渲染器与商品缩略图缓存（specId -> PNG dataURL）
  private iconRenderer: IconRenderer | null = null;
  private iconCache = new Map<string, string>();
  // 程序化地板木纹（只创建一次，环境切换复用）
  private floorTexture: THREE.Texture | null = null;
  // 地板纹理是按皮肤生成的（木纹 / 金属板），记录生成时的皮肤 id，换皮要重做
  private floorTextureTheme = '';
  // 已安装装备的实体（type 之外按 specId 去重）与上次的安装签名
  private equipmentMeshes = new Map<string, THREE.Object3D>();
  private equipmentSignature = '';
  // CO2 是否已装：决定气泡从细化器（右后侧）成股冒出，而非全缸随机
  private co2Installed = false;
  // 已安装灯型 id（影响灯盘亮度/色温），null 表示未装灯
  private installedLightId: string | null = null;
  // 各水草成熟时的目标视觉高度；幼苗到成熟按 size/maxSize 比例缩放
  // 按真实水族比例：水榕低矮阔叶、蜈蚣草高、莫丝贴地、红宫廷中等高、皇冠草中等莲座
  private plantMatureHeight: Record<string, number> = {
    'plant-anubias': 0.75,
    'plant-hornwort': 2.2,
    'plant-moss': 0.45,
    'plant-rotala': 1.8,
    'plant-sword': 1.15,
  };
  private lastSnapshot: Snapshot | null = null;
  private monitor = new PerformanceMonitor();
  private quality: QualityTier = 'high';
  private autoQuality = true;
  // 后期合成与 PBR 环境反射
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private envTexture: THREE.Texture | null = null;
  // 三盏灯留引用：换皮肤时只改颜色与强度，不必重建灯光与阴影贴图
  private ambientLight: THREE.AmbientLight | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  // 全局游动时间，注入鱼与水草材质的顶点动画（各鱼的频率另有逐鱼 uniform）
  private swimTime = { value: 0 };
  private causticsTexture: THREE.Texture | null = null;
  private waterNormalTexture: THREE.Texture | null = null;
  private sandTexture: THREE.Texture | null = null;
  // 鱼的上一帧姿态，用于俯仰与转向侧倾
  private fishPose = new Map<string, { pitch: number; roll: number }>();
  // 每条鱼各自的游泳画像（相位/频率/振幅/胸鳍）
  private fishSwim = new Map<string, SwimProfile>();
  // 点击看鱼：拾取与选中标记
  private raycaster = new THREE.Raycaster();
  private selectionRing: THREE.Mesh | null = null;
  private selectedFishId: string | null = null;
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
  // 当前放置环境 id：换皮肤要按同一环境重建房间，得记住它
  private environmentId: string = DEFAULT_ENVIRONMENT;
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
    // 游戏级观感基线：ACES 电影级色调映射 + 柔和阴影
    // 曝光刻意压在 1.0 以下：浅色缸体 + 环境反射叠在一起很容易过曝发白
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
    this.camera.position.set(0, 2.8, 10);
    this.camera.lookAt(0, 0, 0);

    // 场景底色与雾：取自皮肤，古风皮是宣纸色，远处墙体自然渐隐
    this.scene.background = new THREE.Color(this.skin.background);
    this.scene.fog = new THREE.FogExp2(this.skin.fogColor, this.skin.fogDensity);

    // 暖主光（带阴影）+ 冷补光：冷暖对比让画面有层次
    this.ambientLight = new THREE.AmbientLight(this.skin.ambientColor, this.skin.ambientIntensity);
    this.scene.add(this.ambientLight);
    const keyLight = new THREE.DirectionalLight(this.skin.keyColor, this.skin.keyIntensity);
    keyLight.position.set(4, 9, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -9;
    keyLight.shadow.camera.right = 9;
    keyLight.shadow.camera.top = 9;
    keyLight.shadow.camera.bottom = -9;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.bias = -0.0004;
    this.scene.add(keyLight);
    this.keyLight = keyLight;
    const fillLight = new THREE.DirectionalLight(this.skin.fillColor, this.skin.fillIntensity);
    fillLight.position.set(-6, 4, -4);
    this.scene.add(fillLight);
    this.fillLight = fillLight;

    // PBR 环境反射：给玻璃、金属与鱼体提供真实高光来源
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = this.skin.environmentIntensity;
    pmrem.dispose();

    // 后期管线：HDR 渲染 + Bloom（发光体泛光）+ 输出级色调映射；MSAA 采样保留抗锯齿
    const rt = new THREE.WebGLRenderTarget(
      container.clientWidth, container.clientHeight,
      { type: THREE.HalfFloatType, samples: 4 },
    );
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom 只让真正的发光体（灯盘、鱼鳞高光）泛光，强度压低避免整屏发灰
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      this.skin.bloom.strength, this.skin.bloom.radius, this.skin.bloom.threshold,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // 缸体（玻璃、水、底砂）按形状参数生成，默认长方缸
    this.shapeSpec = getTankShape(DEFAULT_TANK_SHAPE);
    this.motionBounds = this.toMotionBounds(this.shapeSpec);
    this.buildTank(this.shapeSpec);

    // 气泡与柔和水面光束
    this.bubbleTexture = this.makeBubbleTexture();
    this.createBubbles(QUALITY_PRESET[this.quality].bubbles);
    this.createLightShaft();

    // 视角拖拽与缩放，绑定到 canvas
    this.cameraController = new CameraController(this.camera);
    this.detachCamera = this.cameraController.attach(this.renderer.domElement);

    // 默认放置环境（书房桌面）
    this.applyEnvironment(DEFAULT_ENVIRONMENT);
  }

  // 程序化焦散纹理：平铺 Voronoi 边界亮线，模拟水面阳光聚焦网络
  private getCausticsTexture(): THREE.Texture {
    if (!this.causticsTexture) this.causticsTexture = this.makeCausticsTexture();
    return this.causticsTexture;
  }
  private makeCausticsTexture(): THREE.Texture {
    const size = 128;
    const cells = 24;
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < cells; i += 1) pts.push([rand() * size, rand() * size]);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let d1 = Infinity;
        let d2 = Infinity;
        for (const [px, py] of pts) {
          // 环面距离（平铺周期），保证纹理无缝
          let dx = Math.abs(x - px);
          dx = Math.min(dx, size - dx);
          let dy = Math.abs(y - py);
          dy = Math.min(dy, size - dy);
          const d = Math.hypot(dx, dy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) {
            d2 = d;
          }
        }
        const v = Math.round(Math.pow(1 - Math.min(1, (d2 - d1) / 6), 3) * 255);
        const i = (y * size + x) * 4;
        img.data[i] = Math.round(v * 0.85);
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
    return tex;
  }

  // 程序化水面法线：多八度 value noise 高度场求梯度，编码为法线贴图
  private getWaterNormalTexture(): THREE.Texture {
    if (!this.waterNormalTexture) this.waterNormalTexture = this.makeWaterNormalTexture();
    return this.waterNormalTexture;
  }
  private makeWaterNormalTexture(): THREE.Texture {
    const size = 256;
    let seed = 11;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const grids = [8, 16, 32].map((n) => {
      const g = new Array<number>(n * n);
      for (let i = 0; i < n * n; i += 1) g[i] = rand();
      return { n, g };
    });
    const sample = (fx: number, fy: number): number => {
      let sum = 0;
      let amp = 1;
      let total = 0;
      for (const { n, g } of grids) {
        const x = fx * n;
        const y = fy * n;
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const x0 = ((xi % n) + n) % n;
        const y0 = ((yi % n) + n) % n;
        const x1 = (x0 + 1) % n;
        const y1 = (y0 + 1) % n;
        const tx = x - xi;
        const ty = y - yi;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const v00 = g[y0 * n + x0];
        const v10 = g[y0 * n + x1];
        const v01 = g[y1 * n + x0];
        const v11 = g[y1 * n + x1];
        sum += (v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy) * amp;
        total += amp;
        amp *= 0.5;
      }
      return sum / total;
    };
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) height[y * size + x] = sample(x / size, y / size);
    }
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const at = (x: number, y: number): number =>
      height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
    const strength = 3.2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dz = (at(x, y + 1) - at(x, y - 1)) * strength;
        const len = Math.hypot(dx, 1, dz);
        const i = (y * size + x) * 4;
        img.data[i] = Math.round((-dx / len) * 127 + 127);
        img.data[i + 1] = Math.round((1 / len) * 127 + 127);
        img.data[i + 2] = Math.round((-dz / len) * 127 + 127);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }

  // 程序化底砂纹理：细沙颗粒与深浅色斑
  private getSandTexture(): THREE.Texture {
    if (!this.sandTexture) this.sandTexture = this.makeSandTexture();
    return this.sandTexture;
  }  private makeSandTexture(): THREE.Texture {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = this.skin.sandBase;
    ctx.fillRect(0, 0, size, size);
    let seed = 23;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const [r0, g0, b0] = this.skin.sandTone;
    for (let i = 0; i < 2600; i += 1) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 0.6 + rand() * 1.4;
      const k = rand() * this.skin.sandToneSpread;
      const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + k)));
      ctx.fillStyle = `rgba(${ch(r0)}, ${ch(g0)}, ${ch(b0)}, ${0.25 + rand() * 0.3})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
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

  // 生成矩形截面的四棱台光罩：顶部贴合灯条全长、底部铺满缸口，
  // 四个斜面各视角都能看到一片完整光幕（替代原来上小下大的细圆锥——
  // 那东西从正面看就是一道从缸中心射出的窄梯形，完全不像鱼缸灯）。
  // UV：v=1 顶部（渐变纹理 alpha 高）、v=0 底部（alpha 0 自然淡出）；
  // u 横向 0→1，让每面左右两端随纹理淡出、中间最亮，柔化棱角接缝。
  private makeShaftGeometry(
    topW: number, topD: number, botW: number, botD: number, height: number,
  ): THREE.BufferGeometry {
    const halfH = height / 2;
    // 顶面四角 / 底面四角（顺序绕一圈，保证侧面连续）
    const top = [
      [-topW / 2, halfH, -topD / 2], [topW / 2, halfH, -topD / 2],
      [topW / 2, halfH, topD / 2], [-topW / 2, halfH, topD / 2],
    ];
    const bottom = [
      [-botW / 2, -halfH, -botD / 2], [botW / 2, -halfH, -botD / 2],
      [botW / 2, -halfH, botD / 2], [-botW / 2, -halfH, botD / 2],
    ];
    const positions: number[] = [];
    const uvs: number[] = [];
    const push = (p: number[], u: number, v: number): void => {
      positions.push(p[0], p[1], p[2]);
      uvs.push(u, v);
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      // 每个侧面拆两个三角形：顶左→底左→顶右，顶右→底左→底右
      push(top[i], 0, 1); push(bottom[i], 0, 0); push(top[j], 1, 1);
      push(top[j], 1, 1); push(bottom[i], 0, 0); push(bottom[j], 1, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    return geo;
  }

  // 灯具实体 + 光束：缸上方支架式灯盘，光束从灯盘向下发出，随灯光开关联动
  private createLightShaft(): void {
    // 纹理是中性灰渐变，只由材质 color 上色；换皮重建灯具时不能重做，否则旧纹理泄漏
    if (!this.shaftTexture) this.shaftTexture = this.makeShaftTexture();
    const lampGroup = new THREE.Group();

    // 缸口横向/纵向尺寸：box 用 width/depth，cylinder 用直径；灯具按比例适配，不伸出缸外
    const isCyl = this.shapeSpec.kind === 'cylinder';
    const tankW = isCyl ? this.shapeSpec.radius * 2 : this.shapeSpec.width;
    const tankD = isCyl ? this.shapeSpec.radius * 2 : this.shapeSpec.depth;
    const lampW = tankW * 0.78;
    const lampD = tankD * 0.62;
    const postX = tankW * 0.45;

    // 灯具做成"木横梁 + 铜件"：原来是一整块深色扁盒，在暖色房间里像一根黑梁，
    // 现在改成截面更厚的木梁、两端出梁头、上下沿包通长铜条，灯罩外再围一圈铜框。
    const beamY = 1.95;
    const woodMat = new THREE.MeshStandardMaterial({ color: this.skin.lampShell, roughness: 0.72, metalness: 0.06 });
    // 铜件别用满金属度：场景环境反射强度只有 0.16，纯金属在这里会发黑，
    // 反而看不出是铜。降到 0.55 保留一点漫反射底色，铜色才亮得起来
    const brassMat = new THREE.MeshStandardMaterial({ color: this.skin.brass, roughness: 0.42, metalness: 0.55 });

    const beam = new THREE.Mesh(new THREE.BoxGeometry(lampW, 0.2, lampD), woodMat);
    beam.position.y = beamY;
    lampGroup.add(beam);
    // 梁头：两端各一段略高略宽的方木，像穿出墙面的横梁，比纯方块更有木构感
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, lampD * 1.08), woodMat);
      cap.position.set(sx * (lampW / 2 - 0.07), beamY, 0);
      lampGroup.add(cap);
    }
    // 包角铜线：沿梁的四条长棱各贴一根窄条。
    // 不能做成横跨梁顶的整片——俯视时会变成一块金色台面，看不出是"包边"
    for (const dy of [0.088, -0.088]) {
      for (const sz of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(lampW + 0.02, 0.05, 0.03), brassMat);
        strip.position.set(0, beamY + dy, sz * (lampD / 2 + 0.005));
        lampGroup.add(strip);
      }
    }

    // 灯盘底面发光板：开灯时自发光，关灯时变暗
    this.lampGlowMat = new THREE.MeshStandardMaterial({
      color: this.skin.lampGlow, emissive: this.skin.lampGlowEmissive, emissiveIntensity: 1.2, roughness: 0.4,
    });
    const glowW = lampW * 0.84;
    const glowD = lampD * 0.72;
    const glow = new THREE.Mesh(new THREE.BoxGeometry(glowW, 0.05, glowD), this.lampGlowMat);
    glow.position.y = 1.83;
    lampGroup.add(glow);
    // 灯罩铜框：四条细铜条围住发光板，把"一块塑料板"框成一盏灯
    const rimY = 1.83;
    for (const sz of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(glowW + 0.09, 0.09, 0.045), brassMat);
      rim.position.set(0, rimY, sz * (glowD / 2 + 0.022));
      lampGroup.add(rim);
    }
    for (const sx of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.09, glowD + 0.09), brassMat);
      rim.position.set(sx * (glowW / 2 + 0.022), rimY, 0);
      lampGroup.add(rim);
    }

    // 两侧立柱与底座：从底柜台面撑起横梁，柱身加两道铜箍
    const postMat = new THREE.MeshStandardMaterial({ color: this.skin.lampPost, roughness: 0.62, metalness: 0.12 });
    for (const sx of [-postX, postX]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.1, 0.14), postMat);
      post.position.set(sx, 0, 0);
      lampGroup.add(post);
      for (const gy of [1.15, -1.15]) {
        const hoop = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.055, 0.175), brassMat);
        hoop.position.set(sx, gy, 0);
        lampGroup.add(hoop);
      }
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), postMat);
      foot.position.set(sx, -2.05, 0);
      lampGroup.add(foot);
      // 底座铜面：踩在台面上的一层薄铜，和梁上的铜条呼应
      const footPlate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.018, 0.44), brassMat);
      footPlate.position.set(sx, -1.99, 0);
      lampGroup.add(footPlate);
    }

    // 光束：矩形光罩，顶部贴合灯条全长、底部铺满整个缸口，四斜面用渐变纹理柔和淡出
    // ——整缸都被照到，而不是从缸中心射出一束窄梯形聚光。
    // opacity 压低：铺开后前后两层斜面叠加，不压会把上半缸糊成一片白。
    const material = new THREE.MeshBasicMaterial({
      map: this.shaftTexture,
      color: this.skin.shaft, // 带实际色相的青，配合透明渐变，在浅色背景上柔和可见
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    // 光罩底边必须停在底砂上表面（y=-1.575）之上：原来底边 y=-1.75 正好插进
    // 底砂盒子中心，半透明斜面与不透明砂面深度打架，缸底会频闪。
    // 现取上沿 y=1.80（贴发光板下沿）、下沿 y=-1.45（离砂面 0.125），高 3.25。
    this.lightShaft = new THREE.Mesh(
      this.makeShaftGeometry(lampW, lampD, tankW * 0.96, tankD * 0.96, 3.25), material,
    );
    this.lightShaft.position.set(0, 0.175, 0);
    // 不再倾斜：光罩要对称覆盖整缸，歪了反而露馅
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
      if (!on) this.lampGlowMat.color.setHex(this.skin.lampOff);
      // 亮度/色温由已安装灯型决定（见 applyLightFixture）
      this.applyLightFixture();
    }
    // 光照后植物呈现差异化：红宫廷(高草)开灯时叶色更红艳，关灯时黯淡偏绿；
    // 低光植物(水榕/莫丝/皇冠)变化小，仅整体略亮
    for (const mesh of this.plantMeshes.values()) {
      const specId = mesh.userData.specId ?? '';
      mesh.traverse((child) => {
        const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!m || !m.emissive) return;
        if (specId === 'plant-rotala') {
          m.emissive.setHex(on ? 0x661111 : 0x000000);
          m.emissiveIntensity = on ? 0.35 : 0;
        }
      });
    }
  }

  // 取（或首次加载）环境背景纹理；view 缺省取正面图，否则取 `${id}_${view}.jpg`
  // 图片按皮肤分目录：/backgrounds/ink/*.jpg、/backgrounds/cyber/*.jpg
  private getBackgroundTexture(id: string, view?: 'left' | 'right' | 'back'): THREE.Texture {
    const key = `${this.skin.id}/${view ? `${id}_${view}` : id}`;
    const cached = this.backgroundTextures.get(key);
    if (cached) return cached;
    const file = view ? `${id}_${view}.jpg` : `${id}.jpg`;
    const texture = this.textureLoader.load(`/backgrounds/${this.skin.id}/${file}`);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.backgroundTextures.set(key, texture);
    return texture;
  }

  // 切换放置环境：重建背景墙与柜/台面，并更新场景背景色
  applyEnvironment(environmentId: string): void {
    const config: EnvironmentConfig = getEnvironment(environmentId);
    this.environmentId = config.id;
    // 换皮后同一房间的底色不同：暗调房间用 variants 里的暗色，否则会透出宣纸底
    const variant = config.variants?.[this.skin.id];
    const bgColor = variant?.background ?? config.background;
    const wallTint = variant?.wallColor ?? config.wallColor;
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
    this.scene.background = new THREE.Color(bgColor);
    // 雾色与环境背景同步，保证远墙渐隐不露馅
    if (this.scene.fog instanceof THREE.FogExp2) {
      (this.scene.fog.color as THREE.Color).setHex(bgColor);
    }

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
          color: wallTint,
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
      new THREE.MeshStandardMaterial({ color: this.skin.floorTint, roughness: 0.88, map: this.getFloorTexture() }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = WALL_Y - WALL_H / 2;
    floor.receiveShadow = true;
    group.add(floor);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2),
      new THREE.MeshStandardMaterial({ color: this.skin.ceiling, roughness: 1 }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_Y + WALL_H / 2;
    group.add(ceiling);

    // 鱼缸底柜：统一深色（与缸框同色系），作为鱼缸专用支架，不随环境变色，避免与背景图家具冲突
    const cabinet = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 2, 3.2),
      new THREE.MeshStandardMaterial({ color: this.skin.cabinet, roughness: 0.7, metalness: 0.1 }),
    );
    cabinet.position.set(0, -3.1, 0);
    group.add(cabinet);
    // 底柜顶部薄台面：略深，承托缸体
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(7.4, 0.12, 3.4),
      new THREE.MeshStandardMaterial({ color: this.skin.counter, roughness: 0.6, metalness: 0.2 }),
    );
    counter.position.set(0, -2.05, 0);
    group.add(counter);
    this.environmentGroup = group;
    this.scene.add(group);
    // 另一套皮肤的图已经没有任何材质引用（旧墙刚被拆掉），此时才释放。
    // 不能提前释放——那样切换过程中旧墙会短暂失去贴图，画面比闪白更难看
    const prefix = `${this.skin.id}/`;
    this.backgroundTextures.forEach((tex, key) => {
      if (key.startsWith(prefix)) return;
      tex.dispose();
      this.backgroundTextures.delete(key);
    });
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
    if (this.floorTexture && this.floorTextureTheme === this.skin.id) return this.floorTexture;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = this.skin.floorBase;
    ctx.fillRect(0, 0, 256, 256);
    const [br, bg, bb] = this.skin.floorTone;
    const mix = (base: number, d: number) => Math.max(0, Math.min(255, Math.round(base + d)));

    if (this.skin.floorKind === 'panel') {
      // 金属板：先铺格子，每格亮度略有差异，再压一层扫描线，最后用亮线勾缝
      const cell = 64;
      for (let gy = 0; gy < 256 / cell; gy++) {
        for (let gx = 0; gx < 256 / cell; gx++) {
          const k = (Math.random() - 0.5) * 16;
          ctx.fillStyle = `rgb(${mix(br, k)}, ${mix(bg, k)}, ${mix(bb, k)})`;
          ctx.fillRect(gx * cell + 1, gy * cell + 1, cell - 2, cell - 2);
          // 板面细划痕，避免每格纯色像棋盘
          for (let i = 0; i < 5; i++) {
            const ly = gy * cell + 6 + Math.random() * (cell - 12);
            const lx = gx * cell + 4 + Math.random() * (cell - 20);
            ctx.strokeStyle = `rgba(140, 200, 255, ${0.05 + Math.random() * 0.08})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(lx + 6 + Math.random() * 22, ly);
            ctx.stroke();
          }
        }
      }
      ctx.strokeStyle = this.skin.floorSeam;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 256 / cell; i++) {
        const p = i * cell + 0.5;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 256); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(256, p); ctx.stroke();
      }
    } else {
      const plankH = 32;
      for (let row = 0; row < 256 / plankH; row++) {
        const y = row * plankH;
        const tone = (row % 3) * 7;
        ctx.fillStyle = `rgb(${mix(br, tone)}, ${mix(bg, tone)}, ${mix(bb, tone)})`;
        ctx.fillRect(0, y + 1, 256, plankH - 2);
        // 木条接缝
        ctx.fillStyle = this.skin.floorSeam;
        ctx.fillRect(0, y, 256, 1);
        // 逐条细木纹，长度错开，避免像规则条纹
        for (let i = 0; i < 22; i++) {
          const ly = y + 3 + Math.random() * (plankH - 6);
          const lx = Math.random() * 256;
          const len = 30 + Math.random() * 110;
          ctx.strokeStyle = `rgba(146, 116, 88, ${0.08 + Math.random() * 0.1})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx + len, ly + (Math.random() - 0.5) * 1.6);
          ctx.stroke();
        }
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(this.skin.floorRepeat, this.skin.floorRepeat);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.floorTexture = tex;
    this.floorTextureTheme = this.skin.id;
    return tex;
  }

  // 按形状生成缸玻璃、水、底砂
  private buildTank(spec: TankShapeSpec): void {
    const group = new THREE.Group();
    const glassMat = new THREE.MeshStandardMaterial({
      color: this.skin.glass, transparent: true, opacity: this.skin.glassOpacity, metalness: 0.1, roughness: 0.15,
      side: THREE.DoubleSide, depthWrite: false, // 透明玻璃不写深度，避免剔除缸内光束等内部物体
    });
    const waterMat = new THREE.MeshStandardMaterial({
      // 水体透明度压低：过浓会让缸内所有东西糊成一片雾，装备和鱼都看不清
      color: this.skin.water, transparent: true, opacity: this.skin.waterOpacity, depthWrite: false,
      // 水面法线：让水体表面有随光线流动的细碎高光
      normalMap: this.getWaterNormalTexture(),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.35,
    });
    // 底砂：细沙颗粒纹理 + 焦散自发光（水面阳光在砂面的聚焦网）
    const sandMat = new THREE.MeshStandardMaterial({
      color: this.skin.sandColor,
      map: this.getSandTexture(),
      emissive: this.skin.sandEmissive,
      emissiveIntensity: this.skin.sandEmissiveIntensity,
      emissiveMap: this.getCausticsTexture(),
      roughness: 0.9,
    });
    // 真实缸体的上下包边：深色细实体框，有厚度，替代不真实的线框。
    // 赛博皮给框子一点自发光，Bloom 会把它描成一圈霓虹边；古风皮强度为 0，等于没变
    const frameMat = new THREE.MeshStandardMaterial({
      color: this.skin.frame,
      emissive: this.skin.frame,
      emissiveIntensity: this.skin.frameEmissive,
      roughness: 0.5,
      metalness: 0.3,
    });

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
      sandMesh.receiveShadow = true;
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
      sandMesh.receiveShadow = true;
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
    this.shapeSpec = getTankShape(shapeId);
    this.motionBounds = this.toMotionBounds(this.shapeSpec);
    this.rebuildTankAndLamp();
  }

  // 按当前 shapeSpec + skin 重建缸体与灯具，并把依附其上的气泡/水草/道具重新摆好。
  // 换形状与换皮肤都要走这一套，抽出来避免两处漏步。
  private rebuildTankAndLamp(): void {
    if (this.tankGroup) {
      this.scene.remove(this.tankGroup);
      this.disposeGroup(this.tankGroup);
    }
    this.buildTank(this.shapeSpec);
    // 气泡与水草按新边界重建，造景道具按新锚点重摆
    this.createBubbles(QUALITY_PRESET[this.quality].bubbles);
    this.relayoutPlants();
    this.syncProps();
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

  // 运行时换皮肤：色值烤在材质里，凡是"带颜色建出来"的东西都得重建。
  // 顺序是 先预载新皮房间图 → 改全局（灯光/雾/Bloom/纹理缓存）→ 重建实体（缸、灯、房间），
  // 因为重建过程会从 this.skin 取色。
  //
  // 预载这一步是必要的：背景图是异步加载的，若直接重建墙面，图还没解码时
  // 材质只剩 wallColor 兜底，深色房间会闪一下白墙。等图到位再换，切换就是干净的。
  async setTheme(id: SceneSkin['id']): Promise<void> {
    if (this.isDisposed) return;
    const next = getSkin(id);
    // 正在预载：只记下最后的目标，等这一轮结束再接着切
    if (this.themeSwitching) {
      this.pendingTheme = next.id;
      return;
    }
    if (next.id === this.appliedTheme) return;
    this.themeSwitching = true;
    // 先切到新皮，让 getBackgroundTexture 指向新目录（此时还没重建任何实体，画面保持原样）
    this.skin = next;
    try {
      await this.preloadBackgrounds();
    } finally {
      this.themeSwitching = false;
    }
    if (this.isDisposed) return;
    // 预载失败也不影响后续：墙材质会先用 wallColor 兜底，图到了自动补上
    if (this.skin === next) this.applySkinGlobals();
    const queued = this.pendingTheme;
    this.pendingTheme = null;
    if (queued && queued !== this.appliedTheme) void this.setTheme(queued);
  }

  // 把四环境 × 四视图的背景图全部拉进缓存，等解码完成。
  // 这里不走 TextureLoader：它返回的 Texture 要等 onload 才拿到图，墙会先闪一下兜底色。
  // 自己 decode 完再手搓 Texture，就能保证换皮时贴图已经就位，切换是干净的。
  private async preloadBackgrounds(): Promise<void> {
    const views: Array<'left' | 'right' | 'back' | undefined> = [undefined, 'left', 'right', 'back'];
    const jobs: Array<Promise<void>> = [];
    for (const env of ENVIRONMENT_CATALOG) {
      for (const view of views) {
        const key = `${this.skin.id}/${view ? `${env.id}_${view}` : env.id}`;
        const url = `/backgrounds/${this.skin.id}/${view ? `${env.id}_${view}` : env.id}.jpg`;
        jobs.push((async () => {
          try {
            const img = new Image();
            img.src = url;
            await img.decode();
            if (this.isDisposed) return;
            const tex = new THREE.Texture(img);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            this.backgroundTextures.get(key)?.dispose();
            this.backgroundTextures.set(key, tex);
          } catch {
            // 单张失败（文件缺失/解码失败）不拖垮整次切换，墙面会用 wallColor 兜底
          }
        })());
      }
    }
    await Promise.all(jobs);
  }

  // 换皮的第二段：改全局参数并按新皮肤重建实体
  private applySkinGlobals(): void {
    const next = this.skin;

    // 场景底与雾
    this.scene.background = new THREE.Color(next.background);
    if (this.scene.fog instanceof THREE.FogExp2) {
      (this.scene.fog.color as THREE.Color).setHex(next.fogColor);
      this.scene.fog.density = next.fogDensity;
    } else {
      this.scene.fog = new THREE.FogExp2(next.fogColor, next.fogDensity);
    }
    this.scene.environmentIntensity = next.environmentIntensity;

    // 三盏灯只换色与强度，阴影贴图不用重算
    if (this.ambientLight) {
      this.ambientLight.color.setHex(next.ambientColor);
      this.ambientLight.intensity = next.ambientIntensity;
    }
    if (this.keyLight) {
      this.keyLight.color.setHex(next.keyColor);
      this.keyLight.intensity = next.keyIntensity;
    }
    if (this.fillLight) {
      this.fillLight.color.setHex(next.fillColor);
      this.fillLight.intensity = next.fillIntensity;
    }

    // 泛光：赛博靠这一档把霓虹提亮，古风压到几乎不可见
    this.bloomPass.strength = next.bloom.strength;
    this.bloomPass.radius = next.bloom.radius;
    this.bloomPass.threshold = next.bloom.threshold;

    // 两张按皮肤生成的程序化纹理（地板、底砂）作废重做
    this.floorTexture?.dispose();
    this.floorTexture = null;
    this.floorTextureTheme = '';
    this.sandTexture?.dispose();
    this.sandTexture = null;

    // 带颜色的实体：缸体、水、底砂、缸框、灯具
    this.rebuildTankAndLamp();
    // 房间墙面/地板/天花/底柜，以及场景底色（按当前环境的皮肤变体）
    this.applyEnvironment(this.environmentId);

    // 选中光环是基础材质，改个色就行
    if (this.selectionRing) {
      (this.selectionRing.material as THREE.MeshBasicMaterial).color.setHex(next.accent);
    }

    this.appliedTheme = next.id;
  }

  getTheme(): SceneSkin['id'] {
    return this.skin.id;
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

  // 给鱼的 mesh 注入摆尾顶点动画。旧实现有三个硬伤，这里一并修掉：
  // 1) 整条尾巴同相位：所有顶点共用一个 sin 值，只是按权重缩放，等于一块硬板左右扫。
  //    改成沿体轴的行波 —— 相位随 x 滞后，波峰才会由尾柄向尾尖传，鱼身呈 S 形。
  // 2) 相位取自 modelMatrix 的世界坐标：鱼一游动相位就漂，摆尾节奏被自身位移随机调制，
  //    看起来像抽搐而不是游动。改成每条鱼一个固定随机相位。
  // 3) 频率全缸统一：悬停的鱼和急游的鱼同频。改成逐鱼 uniform，由个体实时游速驱动。
  // 返回这条鱼的游泳画像，交给 update 每帧驱动；胸鳍不进顶点动画，改由 update 旋转。
  applyFishWarp(obj: THREE.Object3D, fishId = ''): SwimProfile {
    // 体长必须实测：各鱼种模型尺寸差一倍以上（guppy 体长仅 0.6），
    // 写死 0.2/-0.6 会让体型小的鱼尾部权重永远到不了 1，摆幅白白打个对折
    const box = new THREE.Box3();
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (/eye|pec/i.test(mesh.name ?? '')) return;
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox);
    });
    const bodyLength = Math.max(0.2, box.max.x - box.min.x);
    // 秉性从鱼 id 派生：同种鱼不同个体脾气不同，且刷新后仍是同一副脾气
    const temper = temperOf(fishId);
    const phase = Math.random() * Math.PI * 2;
    const profile: SwimProfile = {
      phase,
      // 初始频率取个体基准：起播就带个性，不会先"全缸同频"再各自漂开
      freq: temper.tailFreqBase,
      yaw: temper.tailYawBase,
      speed: 0.2,
      bodyLength,
      phaseUniform: { value: phase },
      uniforms: {
        uSwimYaw: { value: temper.tailYawBase },
        uTurnBend: { value: 0 },
        uBodyMaxX: { value: box.max.x },
        uBodyInvLen: { value: 1 / bodyLength },
      },
      pecs: [],
      temper,
    };

    // 同种鱼的模板 clone 共享材质，必须逐鱼复制，uniform 才不会串
    const clonedMats = new Map<THREE.Material, THREE.Material>();
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const name = mesh.name ?? '';
      // 眼球跟着头走、胸鳍单独扇动，都不参与顶点形变
      if (/eye/i.test(name)) return;
      if (/pec/i.test(name)) {
        profile.pecs.push({
          obj: mesh,
          baseY: mesh.rotation.y,
          side: /_R$/i.test(name) ? -1 : 1,
        });
        return;
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = mats.map((m) => {
        const cached = clonedMats.get(m);
        if (cached) return cached;
        const cloned = m.clone();
        clonedMats.set(m, cloned);
        this.injectSwimWave(cloned as THREE.MeshStandardMaterial, profile);
        return cloned;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    });
    return profile;
  }

  private injectSwimWave(mat: THREE.MeshStandardMaterial, profile: SwimProfile): void {
    if (mat.userData.swimWarp) return;
    mat.userData.swimWarp = true;
    mat.onBeforeCompile = (shader) => {
      // 注意没有 uSwimTime/uSwimFreq：相位由 CPU 每帧积分好再传进来。
      // 着色器里做 time*freq 的话，freq 一变相位就跳——见 SwimProfile 的注释
      shader.uniforms.uSwimPhase = profile.phaseUniform;
      shader.uniforms.uSwimYaw = profile.uniforms.uSwimYaw;
      shader.uniforms.uTurnBend = profile.uniforms.uTurnBend;
      shader.uniforms.uBodyMaxX = profile.uniforms.uBodyMaxX;
      shader.uniforms.uBodyInvLen = profile.uniforms.uBodyInvLen;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uSwimPhase;
          uniform float uSwimYaw;
          uniform float uTurnBend;
          uniform float uBodyMaxX;
          uniform float uBodyInvLen;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            // 体轴归一化：吻端 0 → 尾尖 1（按模型实测包围盒，不写死坐标）
            float t = clamp((uBodyMaxX - position.x) * uBodyInvLen, 0.0, 1.0);
            // 行波：相位沿体轴滞后，波峰由头向尾传，鱼身才会呈 S 形而不是整体平移。
            // uSwimPhase 是累计相位，随游速连续变化，不随全局时间突变
            float ang = uSwimPhase - t * 3.4;
            // 摆角向尾部集中，头颈保持稳定
            float w = pow(t, 1.6);
            // 绕头部竖直轴偏转，而不是沿 z 轴平移：
            // 平移在大多数视角下都是朝向/远离相机的，屏幕上根本看不出来；
            // 摆尾真正的读感来自尾鳍朝向的变化（投影变窄 + 轮廓摆动）
            float yaw = sin(ang) * uSwimYaw * w + uTurnBend * w;
            float c = cos(yaw);
            float s = sin(yaw);
            float dx = transformed.x - uBodyMaxX;
            transformed.x = uBodyMaxX + dx * c - transformed.z * s;
            transformed.z = dx * s + transformed.z * c;
          }`,
        );
    };
  }

  // 给水草注入摆动顶点动画：越靠叶尖（本地 y 越高）摆幅越大，
  // 用世界位置做每株独立相位；CPU 侧 rotation 摆动整体太"板"，换成顶点级
  applyPlantSway(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        const mat = m as THREE.MeshStandardMaterial;
        if (mat.userData.swayInjected) return;
        mat.userData.swayInjected = true;
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uSwimTime = this.swimTime;
          shader.vertexShader = shader.vertexShader
            .replace(
              '#include <common>',
              `#include <common>
              uniform float uSwimTime;`,
            )
            .replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
              {
                // 高度权重：贴地 0 → 顶部 1
                float hW = clamp(position.y, 0.0, 1.0);
                float phase = modelMatrix[3][0] * 2.3 + modelMatrix[3][2] * 1.7;
                float slow = sin(uSwimTime * 0.9 + phase);
                float fine = sin(uSwimTime * 1.7 + phase * 1.3) * 0.35;
                transformed.x += (slow + fine) * 0.045 * hW * hW;
                transformed.z += cos(uSwimTime * 0.7 + phase) * 0.02 * hW;
              }`,
            );
        };
      });
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
  private createFishMesh(i: number, specId: string, variant: string, fishId = ''): THREE.Object3D {
    const rare = variant === COMMON_VARIANT ? undefined : getRareVariant(specId, variant);
    let obj: THREE.Object3D;
    const typed = this.fishTemplates.get(specId);
    if (typed) {
      obj = typed.clone(true);
      if (rare) this.applyVariantTint(obj, rare.color);
    } else if (this.fishTemplate) {
      obj = this.fishTemplate.clone(true);
      if (rare) this.applyVariantTint(obj, rare.color);
    } else {
      const palette = this.skin.fishFallback;
      const color = rare ? rare.color : palette[i % palette.length];
      const geometry = new THREE.ConeGeometry(0.18, 0.6, 8);
      // 朝向烘焙进几何体：update 每帧覆写 rotation.x/z（俯仰/侧倾），不能再依赖 mesh.rotation.z
      geometry.rotateZ(Math.PI / 2);
      obj = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color }),
      );
    }
    // 摆尾顶点动画（放在换色之后，确保注入的是最终材质）；鱼在砂面上投下软阴影。
    // 传入鱼 id：摆尾参数的个体差从 id 派生，否则克隆鱼会共用同一副脾气
    obj.userData.swim = this.applyFishWarp(obj, fishId);
    obj.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    // 欧拉序 YXZ：俯仰(z)/侧倾(x)在偏航(y)之前应用，侧倾才绕鱼自身前进轴
    obj.rotation.order = 'YXZ';
    return obj;
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
        this.fishSwim.delete(id);
        this.fishPose.delete(id);
      }
    }
    // 新增鱼
    snapshot.fishes.forEach((f, i) => {
      if (!this.fishMeshes.has(f.id)) {
        const mesh = this.createFishMesh(i, f.specId, f.variant, f.id);
        this.scene.add(mesh);
        this.fishMeshes.set(f.id, mesh);
        this.fishMotion.set(f.id, createMotionState(f.specId, Math.random, this.motionBounds, temperOf(f.id)));
        const swim = mesh.userData.swim as SwimProfile | undefined;
        if (swim) this.fishSwim.set(f.id, swim);
      }
    });
  }

  // 造一株水草：优先按 specId 克隆 glb 模板，否则回退圆锥占位
  // glb 与占位的几何原点都在底部，使缩放（生长）时从砂面向上长
  private createPlantMesh(specId: string, fallbackIndex: number): THREE.Object3D {
    const template = this.plantTemplates.get(specId);
    if (template) {
      const cloned = template.clone(true);
      cloned.userData.specId = specId;
      this.applyPlantSway(cloned);
      return cloned;
    }
    const geometry = new THREE.ConeGeometry(0.12, 0.8, 6);
    geometry.translate(0, 0.4, 0);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: this.skin.plantFallback[fallbackIndex % this.skin.plantFallback.length],
        roughness: 0.8,
      }),
    );
    this.applyPlantSway(mesh);
    return mesh;
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
        // 新植株加入后重发光照状态，使其获得对应物种的光照表现
        this.currentLightOn = null;
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
        id,
      );
      // 立即从保留的运动状态恢复位置与朝向，避免首帧前重叠在原点
      const motion = this.fishMotion.get(id);
      if (motion) {
        fresh.position.set(motion.x, motion.y, motion.z);
        fresh.rotation.y = motion.heading;
      }
      this.scene.add(fresh);
      this.fishMeshes.set(id, fresh);
      const swim = fresh.userData.swim as SwimProfile | undefined;
      if (swim) this.fishSwim.set(id, swim);
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

  // 加载造景道具（岩石/沉木）并按当前缸形摆放；形状切换时重摆
  async loadProps(specIds: string[]): Promise<{ loaded: string[]; failed: string[] }> {
    const loaded: string[] = [];
    const failed: string[] = [];
    await Promise.all(
      specIds.map(async (specId) => {
        if (this.propTemplates.has(specId)) {
          loaded.push(specId);
          return;
        }
        try {
          const result = await loadModel(`/models/props/${specId}.glb`);
          if (this.isDisposed) return;
          this.propTemplates.set(specId, result.group);
          loaded.push(specId);
        } catch {
          failed.push(specId);
        }
      }),
    );
    if (!this.isDisposed) this.syncProps();
    return { loaded: loaded.sort(), failed: failed.sort() };
  }

  // 造景道具摆放锚点：石头群落在左后方，沉木在右后方，避开植物区
  private propAnchor(specId: string): { x: number; z: number; y: number; scale: number; rotY: number } {
    const hx = this.motionBounds.halfX;
    const hz = this.motionBounds.halfZ;
    switch (specId) {
      case 'rock-a':
        return { x: -hx * 0.58, z: -hz * 0.52, y: -1.2, scale: 0.68, rotY: 0.7 };
      case 'rock-b':
        return { x: -hx * 0.38, z: -hz * 0.2, y: -1.35, scale: 0.4, rotY: 2.1 };
      case 'rock-c':
        return { x: -hx * 0.66, z: -hz * 0.18, y: -1.25, scale: 0.82, rotY: 4.4 };
      case 'driftwood':
        return { x: hx * 0.42, z: -hz * 0.38, y: -1.4, scale: 0.9, rotY: -0.4 };
      default:
        return { x: 0, z: 0, y: -1.4, scale: 1, rotY: 0 };
    }
  }

  // 按模板重建缸内造景组；形状切换后重新计算锚点
  private syncProps(): void {
    if (this.propGroup) {
      this.scene.remove(this.propGroup);
      // 几何/材质与模板共享，clone 的实体不释放共享资源
    }
    if (this.propTemplates.size === 0) return;
    const group = new THREE.Group();
    this.propTemplates.forEach((template, specId) => {
      const mesh = template.clone(true);
      const a = this.propAnchor(specId);
      mesh.position.set(a.x, a.y, a.z);
      mesh.scale.setScalar(a.scale);
      mesh.rotation.y = a.rotY;
      mesh.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      group.add(mesh);
    });
    this.propGroup = group;
    this.scene.add(group);
  }

  // 已安装装备的缸内/缸外实体：按类型定锚点，模型复用商店同一套 glb。
  // 锚点原则：缸内设备贴壁下水、缸外设备落在底柜台面（不是地面），保证镜头里一定看得见
  private syncEquipment(snapshot: Snapshot): void {
    const specById = new Map(EQUIPMENT_CATALOG.map((e) => [e.id, e]));
    const wanted = new Map<string, string>(); // specId -> type
    Object.values(snapshot.installed).forEach((specId) => {
      const spec = specById.get(specId);
      // 灯具不摆实体（缸上已有灯盘），改为让灯盘亮度/色温随灯型变化
      if (spec && spec.type !== 'light') wanted.set(specId, spec.type);
    });
    this.co2Installed = [...wanted.values()].includes('co2');
    this.installedLightId = snapshot.installed.light ?? null;
    this.applyLightFixture();
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

  // 装备摆放锚点：缸内设备贴壁下水，缸外设备落在底柜台面（台面约 y=-2.05），
  // 保证正视角下都能看到，不会掉到画面外或埋进柜体
  private equipmentAnchor(
    type: string,
    specId: string,
  ): { x: number; y: number; z: number; scale: number; rotY: number } {
    const hx = this.motionBounds.halfX;
    const hz = this.motionBounds.halfZ;
    const STAND_Y = -2.05; // 底柜台面高度
    const SAND_Y = -1.55; // 砂面高度
    if (type === 'heater') {
      // 加热棒：缸内右后角，竖立在砂面上，贴近后壁
      return { x: hx * 0.72, y: SAND_Y, z: -hz * 0.62, scale: 0.82, rotY: 0.3 };
    }
    if (type === 'filter') {
      if (specId === 'filter-canister') {
        // 外置滤桶：缸外右侧台面
        return { x: hx + 0.55, y: STAND_Y, z: -0.1, scale: 0.9, rotY: 0.3 };
      }
      if (specId === 'filter-sump') {
        // 底滤槽：缸前下方台面，压扁一点避免挡住缸体下缘
        return { x: -hx * 0.45, y: STAND_Y, z: hz + 0.55, scale: 0.55, rotY: 0.1 };
      }
      // 壁挂过滤：挂在缸内右后壁上，正面朝观众
      return { x: hx * 0.78, y: -0.5, z: -hz * 0.9, scale: 0.9, rotY: 0 };
    }
    if (type === 'co2') {
      // CO2 钢瓶：缸外右侧台面，靠前一点
      return { x: hx + 0.45, y: STAND_Y, z: 0.75, scale: 0.85, rotY: -0.2 };
    }
    return { x: 0, y: STAND_Y, z: 0, scale: 1, rotY: 0 };
  }

  // 灯盘随已安装灯型变化：造景灯更亮更冷白，普通灯略暖；关灯时都变暗
  private applyLightFixture(): void {
    if (!this.lampGlowMat) return;
    if (!this.currentLightOn) {
      this.lampGlowMat.emissiveIntensity = 0.04;
      return;
    }
    const isPlant = this.installedLightId === 'light-plant';
    // 原来两种灯用两个几乎同色的白（0xeaf7ff / 0xeaf6fb），差别只在亮度；
    // 现在统一取皮肤色，靠 emissiveIntensity 区分亮度就够了
    this.lampGlowMat.emissiveIntensity = isPlant ? 2.0 : this.installedLightId ? 1.5 : 1.2;
    this.lampGlowMat.color.setHex(this.skin.lampGlow);
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
    // 摆尾/摆草共用一根时间轴。频率不再乘全缸的 swimScale ——
    // 每条鱼的摆尾频率由它自己的游速决定（见下方 swim profile），
    // 再乘一次全局系数就成了双重调制。
    this.swimTime.value += dt;
    // 焦散与水面法线缓慢流动：两张纹理反向漂移，避免同步运动的假感
    if (this.causticsTexture) {
      this.causticsTexture.offset.x = timeSeconds * 0.015;
      this.causticsTexture.offset.y = timeSeconds * 0.008;
    }
    if (this.waterNormalTexture) {
      this.waterNormalTexture.offset.x = timeSeconds * 0.02;
      this.waterNormalTexture.offset.y = -timeSeconds * 0.012;
    }
    snapshot.fishes.forEach((f) => {
      const mesh = this.fishMeshes.get(f.id)!;
      const prev = this.fishMotion.get(f.id)!;
      const swim = this.fishSwim.get(f.id);
      const temper = swim?.temper ?? temperOf(f.id);
      // 冲刺—滑行节奏：真小鱼是摆尾几下加速、然后收尾滑行，不是匀速巡航。
      // 匀速平移是"呆板"的主要来源之一，这一层几乎免费——摆尾频率本来就跟游速走。
      // 节奏参数走个体秉性：有的鱼几乎匀速巡游，有的冲滑分明；
      // 周期（dartFreq）与深度（dartDepth）都是这条鱼自己的，不同鱼不会同步起伏
      const burst = 0.5 + 0.5 * Math.sin(timeSeconds * temper.dartFreq + prev.seed);
      const dart = 1 - 0.45 * temper.dartDepth
        + 0.75 * temper.dartDepth * Math.pow(burst, 1.6);
      const next = updateMotion({
        state: prev,
        specId: f.specId,
        behaviorSpeed: speedByBehavior[f.behavior] * dart,
        dt,
        time: timeSeconds,
        rand: Math.random,
        bounds: this.motionBounds,
        temper,
      });
      this.fishMotion.set(f.id, next);
      mesh.position.set(next.x, next.y, next.z);
      mesh.rotation.y = next.heading;
      // 俯仰/侧倾都做低通平滑：直接取每帧位移差会带进随机噪声，鱼身会逐帧抖
      const vy = dt > 1e-6 ? (next.y - prev.y) / dt : 0;
      const pitchTarget = Math.max(-0.25, Math.min(0.25, vy * 0.45));
      // 侧倾系数刻意压小：转向时的内倾是细节，幅度大了鱼会像一直歪着身子
      const rollTarget = Math.max(-0.22, Math.min(0.22, -next.turnRate * 0.14));
      const pose = this.fishPose.get(f.id) ?? { pitch: 0, roll: 0 };
      const k = Math.min(1, 5 * dt);
      pose.pitch += (pitchTarget - pose.pitch) * k;
      pose.roll += (rollTarget - pose.roll) * k;
      // 欧拉序改为 YXZ：先俯仰/侧倾再偏航，侧倾才绕鱼自身前进轴，不会随航向乱转
      mesh.rotation.z = pose.pitch;
      mesh.rotation.x = pose.roll;
      this.fishPose.set(f.id, pose);

      if (swim) {
        // 摆尾：频率与振幅跟着这条鱼自己的游速走 —— 悬停时慢摆、急游时快摆，
        // 这是"活"的一半来源。基准值与增益都来自个体秉性：同种鱼里
        // 也有天生尾巴勤快的和天生慢条斯理的
        const inst = dt > 1e-6 ? Math.hypot(next.x - prev.x, next.z - prev.z) / dt : 0;
        swim.speed += (inst - swim.speed) * Math.min(1, 3 * dt);
        const targetFreq = temper.tailFreqBase + swim.speed * temper.tailFreqSpeedK;
        swim.freq += (targetFreq - swim.freq) * Math.min(1, 2.5 * dt);
        // 相位积分：唯一的相位来源。频率怎么变，相位都只按 freq*dt 连续推进，
        // 绝不会出现 time*freq 那种"频率一变相位猛跳"的抽搐
        swim.phaseUniform.value += swim.freq * dt;
        // 偏转角随游速增大：悬停约 10°，急游到 30° 左右。
        // 折算成横向摆幅约为体长的 10%~30%，低于 10% 在正常镜头距离上读不出来
        swim.yaw = temper.tailYawBase + swim.speed * temper.tailYawSpeedK;
        swim.uniforms.uSwimYaw.value = swim.yaw;
        // 头部随摆尾轻微左右摆：正面视角下摆尾是深度方向的，真正让鱼"活"的
        // 是这几度的头部偏摆。相位直接复用累计相位，与体波同源不脱节
        const headSway = Math.sin(swim.phaseUniform.value) * temper.headSway;
        mesh.rotation.y = next.heading + headSway;
        // 转弯时身体弯成弧。做低通：直接取 turnRate 会在贴边转向时一步顶到限幅，
        // 鱼身像被折断；平滑后是一段渐进的弧
        const bendTarget = Math.max(-0.16, Math.min(0.16, -next.turnRate * 0.07));
        swim.uniforms.uTurnBend.value += (bendTarget - swim.uniforms.uTurnBend.value) * Math.min(1, 3 * dt);
        // 胸鳍绕根部扇动：左右反相，频率略慢于摆尾，悬停时才有"扑扇"的读感。
        // 幅度走个体秉性；相位从累计相位导出，不会在频率变化时跳变
        for (const pec of swim.pecs) {
          const pecPhase = swim.phaseUniform.value * 0.9 + swim.phase + (pec.side > 0 ? 0 : Math.PI);
          pec.obj.rotation.y = pec.baseY + Math.sin(pecPhase) * temper.pecAmp;
        }
      }
    });
    // 水草随引擎 size 缩放，体现生长：幼苗到成熟按 size/maxSize 比例，再乘成熟视觉高度
    // 视觉比例做下限重映射（幼苗 0.2 → 视觉 0.66），新种下就能看清，成熟后仍是明显长大
    // 摆动已由 applyPlantSway 注入的顶点动画承担（叶尖摆、根部稳），不再做 CPU 整体旋转
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

    // 选中标记环贴着选中的鱼游动，位于其正下方砂面上方一点
    if (this.selectionRing) {
      if (this.selectedFishId) {
        const mesh = this.fishMeshes.get(this.selectedFishId);
        if (mesh) {
          this.selectionRing.visible = true;
          this.selectionRing.position.set(mesh.position.x, -1.62, mesh.position.z);
        } else {
          this.selectionRing.visible = false;
        }
      } else {
        this.selectionRing.visible = false;
      }
    }

    this.cameraController.update(elapsed);
    // 后期管线渲染（Bloom + 输出色调映射），取代直接 renderer.render
    this.composer.render();
  }

  // 点击拾取：从 canvas 像素坐标发射射线，返回命中的鱼 id（未命中返回 null）
  pickFish(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = [...this.fishMeshes.values()];
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length === 0) return null;
    // 命中的子网格向上回溯到注册的鱼根节点
    for (let o: THREE.Object3D | null = hits[0].object; o; o = o.parent) {
      for (const [id, mesh] of this.fishMeshes) {
        if (mesh === o) return id;
      }
    }
    return null;
  }

  // 选中/取消选中一条鱼：青色圆环贴在鱼下方水面高度；传 null 取消
  setSelectedFish(fishId: string | null): void {
    this.selectedFishId = fishId;
    if (!fishId) {
      if (this.selectionRing) this.selectionRing.visible = false;
      return;
    }
    if (!this.selectionRing) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.025, 8, 48),
        new THREE.MeshBasicMaterial({ color: this.skin.accent, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.selectionRing = ring;
      this.scene.add(ring);
    }
    this.selectionRing.visible = true;
  }

  start(onFrame: (dt: number) => void): void {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      onFrame(dt);
      // 采样始终推进；用户手动选档后不再自动干预
      const reported = this.monitor.sample(now);
      if (reported && this.autoQuality) {
        const next = tierFromFps(this.monitor.fps, this.quality);
        if (next !== this.quality) this.setQuality(next);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // 切换画质档位：调整像素比上限，低档关闭后期（Bloom）并降低渲染分辨率与气泡数量。
  // byUser 为 true 时关闭自动调档，避免手动选择被下一帧覆盖。
  setQuality(tier: QualityTier, byUser = false): void {
    if (byUser) this.autoQuality = false;
    this.quality = tier;
    const preset = QUALITY_PRESET[tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio));
    this.bloomPass.enabled = preset.postProcessing;
    this.createBubbles(preset.bubbles);
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
    // 后期合成器与渲染目标同步分辨率与像素比
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_PRESET[this.quality].maxPixelRatio));
    this.composer.setSize(w, h);
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
    this.propTemplates.forEach((tpl) => this.disposeFishObject(tpl));
    this.propTemplates.clear();
    this.propGroup = null;
    this.iconRenderer?.dispose();
    this.iconRenderer = null;
    this.iconCache.clear();
    this.environmentGroup = null;
    this.tankGroup = null;
    this.lampGroup = null;
    // 纹理被材质引用，需单独释放；背景纹理缓存统一释放
    this.bubbleTexture?.dispose();
    this.shaftTexture?.dispose();
    this.causticsTexture?.dispose();
    this.waterNormalTexture?.dispose();
    this.sandTexture?.dispose();
    this.backgroundTextures.forEach((tex) => tex.dispose());
    this.backgroundTextures.clear();
    // 后期合成器与 PBR 环境贴图
    this.composer.dispose();
    this.envTexture?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
