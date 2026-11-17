// 3D 场景皮肤：把原本散落在 Renderer 里的硬编码色值收成一份可切换的配置。
//
// 之前这些颜色直接写在构造场景、建缸、建灯的代码里（背景、雾、主光、补光、玻璃、
// 水体、底砂、缸框、灯罩、光束……），想换风格只能一路改过去，还容易漏。
// 现在按"一套皮 = 一个对象"来组织，Renderer 只认 SceneSkin，不认具体颜色。
//
// 运行中可以切换：Renderer.setTheme() 会按新皮肤重建缸体、灯具、房间与地板，
// 并改写灯光 / 雾 / Bloom 参数。皮肤只描述"长什么样"，重建流程统一放在 Renderer 里。
//
// 房间背景图跟着皮肤走：/backgrounds/{skin.id}/*.jpg。图不在皮肤对象里，
// 因为路径靠 id 拼，换皮时清空纹理缓存即可。

export interface SceneSkin {
  id: 'ink' | 'cyber';
  name: string;

  // 场景底与雾
  background: number;
  fogColor: number;
  fogDensity: number;

  // 光照：一暖一冷，冷暖差是画面层次的来源
  ambientColor: number;
  ambientIntensity: number;
  keyColor: number;
  keyIntensity: number;
  fillColor: number;
  fillIntensity: number;
  environmentIntensity: number;

  // 后期泛光
  bloom: { strength: number; radius: number; threshold: number };

  // 房间地板与天花板
  floorTint: number;
  ceiling: number;
  // 地板程序化纹理：古风是木条，赛博是暗金属板 + 缝隙亮线
  floorKind: 'plank' | 'panel';
  floorBase: string; // 纹理底色
  floorTone: [number, number, number]; // 面板/木条基准 RGB
  floorSeam: string; // 缝隙与纹理描边色
  floorRepeat: number; // 平铺次数

  // 底柜与台面
  cabinet: number;
  counter: number;

  // 灯盘：外壳、立柱、发光板（开灯色 / 自发光色 / 关灯色）
  lampShell: number;
  lampPost: number;
  lampGlow: number;
  lampGlowEmissive: number;
  lampOff: number;
  shaft: number;
  brass: number; // 灯具上的铜件（梁上下沿、灯罩边框、立柱铜箍）

  // 缸体
  glass: number;
  glassOpacity: number;
  water: number;
  waterOpacity: number;
  frame: number;
  // 缸框自发光：赛博皮靠它给鱼缸描一圈霓虹边（配合 Bloom），古风为 0
  frameEmissive: number;

  // 底砂：材质底色、自发光（焦散网的色相）、程序化沙粒纹理的两个基准色
  sandColor: number;
  sandEmissive: number;
  sandEmissiveIntensity: number;
  sandBase: string; // 程序化沙粒纹理的底色
  sandTone: [number, number, number]; // 沙粒基准 RGB
  sandToneSpread: number; // 沙粒亮度抖动范围

  // 选中标记（点选一条鱼时脚下那圈光环）
  accent: number;

  // 模型缺失时的占位色，避免回落到默认的荧光色破坏整体调子
  fishFallback: number[];
  plantFallback: number[];
}

// 古风皮：宣纸底、石绿水、墨褐色缸架、暖日光。
// 原则是把饱和度整体压下来，蓝味去掉，让鱼缸像摆在书房里的一件旧物
export const INK_SKIN: SceneSkin = {
  id: 'ink',
  name: '水墨',

  background: 0xe9e2d1,
  fogColor: 0xe9e2d1,
  fogDensity: 0.009,

  ambientColor: 0xfff4e2,
  ambientIntensity: 0.5,
  keyColor: 0xffe6bd,
  keyIntensity: 1.45,
  fillColor: 0xa9c4b6,
  fillIntensity: 0.36,
  environmentIntensity: 0.16,

  bloom: { strength: 0.22, radius: 0.45, threshold: 0.9 },

  floorTint: 0xa88d6b,
  ceiling: 0xe4dbc8,
  floorKind: 'plank',
  floorBase: '#ab9d8c',
  floorTone: [176, 162, 142],
  floorSeam: 'rgba(120, 96, 74, 0.30)',
  floorRepeat: 4,

  cabinet: 0x4a3b2c,
  counter: 0x3b2f23,

  lampShell: 0x2f2a22,
  lampPost: 0x4a4034,
  lampGlow: 0xf6efdc,
  lampGlowEmissive: 0xffe2b0,
  lampOff: 0x5a5a4e,
  shaft: 0xd8c79c,
  brass: 0xc9a06a,

  glass: 0xd7e4d8,
  glassOpacity: 0.14,
  water: 0x6f948a,
  waterOpacity: 0.22,
  frame: 0x4a4034,
  frameEmissive: 0,

  sandColor: 0xece2cb,
  sandEmissive: 0xcfe0cc,
  sandEmissiveIntensity: 0.22,
  sandBase: '#ddd2b8',
  sandTone: [204, 190, 162],
  sandToneSpread: 40,

  fishFallback: [0xc0704f, 0x7d9c6a, 0xd9b463, 0x8fa8b8, 0xa98aa0, 0xb8544a, 0x6f9a92, 0xd9a05b],
  plantFallback: [0x5f8560, 0x77a06b, 0x436b45],
  accent: 0xb0432f,
};

// 赛博皮：冷黑底、青紫霓虹、高泛光。
// 这套还没接到 UI 开关上，先备着——切换只需把 Renderer 里取的常量换掉
export const CYBER_SKIN: SceneSkin = {
  id: 'cyber',
  name: '霓虹',

  background: 0x0b1020,
  fogColor: 0x0b1020,
  fogDensity: 0.014,

  ambientColor: 0x33406b,
  ambientIntensity: 0.6,
  keyColor: 0x9ad7ff,
  keyIntensity: 1.4,
  fillColor: 0xff5fbf,
  fillIntensity: 0.5,
  environmentIntensity: 0.35,

  bloom: { strength: 0.85, radius: 0.7, threshold: 0.6 },

  floorTint: 0x2e3b64,
  ceiling: 0x0d1220,
  floorKind: 'panel',
  floorBase: '#080e1a',
  floorTone: [20, 29, 48],
  floorSeam: 'rgba(58, 152, 226, 0.26)',
  floorRepeat: 3,

  cabinet: 0x141c33,
  counter: 0x0d1326,

  lampShell: 0x101a2e,
  lampPost: 0x1b2b4a,
  lampGlow: 0x9ff0ff,
  lampGlowEmissive: 0x38d6ff,
  lampOff: 0x25304a,
  // 光束色刻意压暗：Bloom 强度 0.85 会把亮色再提一档，用满亮青会变成一根实心光柱
  shaft: 0x2a9bbd,
  brass: 0x8fb6ff,

  glass: 0x8fe6ff,
  glassOpacity: 0.12,
  water: 0x1d6fa8,
  waterOpacity: 0.17,
  frame: 0x1f3b5c,
  frameEmissive: 0.55,

  sandColor: 0x101a30,
  sandEmissive: 0x2ec7ff,
  sandEmissiveIntensity: 0.4,
  sandBase: '#1a2340',
  sandTone: [44, 58, 96],
  sandToneSpread: 34,

  fishFallback: [0xff6b9d, 0x54e6ff, 0xb98cff, 0x6bffb8, 0xffd166, 0xff8b5e, 0x7aa2ff, 0xc9ff5e],
  plantFallback: [0x2e7d6a, 0x3fa88c, 0x1f5c52],
  accent: 0x35d0c5,
};

export const DEFAULT_SCENE_SKIN = INK_SKIN;

export const SCENE_SKINS: Record<SceneSkin['id'], SceneSkin> = {
  ink: INK_SKIN,
  cyber: CYBER_SKIN,
};

export function getSkin(id: string): SceneSkin {
  return SCENE_SKINS[id as SceneSkin['id']] ?? DEFAULT_SCENE_SKIN;
}
