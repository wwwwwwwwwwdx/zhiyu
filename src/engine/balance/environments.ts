// 放置环境配置（纯数据，零 three 依赖）：鱼缸所处的房间位置，决定背景色调与环境光。
// 位于引擎层，引擎读取 ambientExposure 影响爆藻，渲染层读取颜色做视觉。

export type EnvironmentId = 'desk' | 'living' | 'windowsill' | 'entryway';

export interface EnvironmentConfig {
  id: EnvironmentId;
  name: string;
  background: number; // 场景背景色
  wallColor: number; // 背景墙颜色
  furnitureColor: number; // 柜/桌面颜色
  hasWindow: boolean; // 是否显示窗户
  ambientExposure: number; // 环境光暴露 0-1，进入引擎影响藻类
  // 皮肤变体：换皮后背景图整组换掉，场景底色与墙面乘数也得跟着换一档，
  // 否则暗调房间里会透出一块宣纸色的底。古风用上面三个默认字段，赛博在这里覆盖
  variants?: Record<string, { background: number; wallColor: number }>;
}

export const DEFAULT_ENVIRONMENT: EnvironmentId = 'desk';

export const ENVIRONMENT_CATALOG: EnvironmentConfig[] = [
  {
    // 书房：背景图是古风书案，底色与墙色都跟着走暖纸调。
    // wallColor 会作为乘数染在背景图上，用纯冷白会把照片染蓝，这里取近白偏暖
    id: 'desk', name: '书房桌面',
    background: 0xe9e2d1, wallColor: 0xfbf6ea, furnitureColor: 0x8a6f52,
    hasWindow: false, ambientExposure: 0,
    variants: { cyber: { background: 0x0a1020, wallColor: 0xdbe7ff } },
  },
  {
    // 客厅：条案挂轴那面墙，与书房同一套暖纸调
    id: 'living', name: '客厅柜',
    background: 0xe9e2d1, wallColor: 0xfbf6ea, furnitureColor: 0x8a6f52,
    hasWindow: false, ambientExposure: 0,
    variants: { cyber: { background: 0x0a1020, wallColor: 0xdbe7ff } },
  },
  {
    // 窗台：整面木格窗透着日光，底色要比另外三个亮一档，才能托住高调的照片
    id: 'windowsill', name: '阳光窗台',
    background: 0xf1ebda, wallColor: 0xfefbf4, furnitureColor: 0xc9b189,
    hasWindow: true, ambientExposure: 0.35,
    variants: { cyber: { background: 0x0d1628, wallColor: 0xe4eeff } },
  },
  {
    // 玄关：一对宫灯的黄光压在墙上，底色偏暖偏沉一点
    id: 'entryway', name: '玄关',
    background: 0xe6dcc6, wallColor: 0xf6eedd, furnitureColor: 0x8a6f52,
    hasWindow: false, ambientExposure: 0,
    variants: { cyber: { background: 0x090e1c, wallColor: 0xd6e2fb } },
  },
];

export function getEnvironment(id: string): EnvironmentConfig {
  return ENVIRONMENT_CATALOG.find((e) => e.id === id) ?? ENVIRONMENT_CATALOG[0];
}
