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
}

export const DEFAULT_ENVIRONMENT: EnvironmentId = 'desk';

export const ENVIRONMENT_CATALOG: EnvironmentConfig[] = [
  {
    id: 'desk', name: '书房桌面',
    background: 0xd6ecf4, wallColor: 0xe8f3f8, furnitureColor: 0xc8b89a,
    hasWindow: false, ambientExposure: 0,
  },
  {
    id: 'living', name: '客厅柜',
    background: 0xe6f0ea, wallColor: 0xf0ece4, furnitureColor: 0xb09a82,
    hasWindow: false, ambientExposure: 0,
  },
  {
    id: 'windowsill', name: '阳光窗台',
    background: 0xf2f6e8, wallColor: 0xf7f5ea, furnitureColor: 0xd8d2c0,
    hasWindow: true, ambientExposure: 0.35,
  },
  {
    id: 'entryway', name: '玄关',
    background: 0xdceaf2, wallColor: 0xe4eef3, furnitureColor: 0x9aa8b0,
    hasWindow: false, ambientExposure: 0,
  },
];

export function getEnvironment(id: string): EnvironmentConfig {
  return ENVIRONMENT_CATALOG.find((e) => e.id === id) ?? ENVIRONMENT_CATALOG[0];
}
