# zhiyu 知鱼

数字生态缸：以真实水族生态模拟为底座的桌面解压产品。本仓库为 Web 端 V1 工程骨架（M0 阶段）。

## 技术栈

- TypeScript 5 + Vite 6 + React 18
- Three.js（裸用，渲染层）
- Zustand（UI 状态）、Vitest（引擎测试）
- 纯 TS 模拟引擎（零 DOM/渲染依赖，可迁移 Worker、可复用于小程序端）

## 快速开始

```bash
pnpm install
pnpm dev        # 本地开发
pnpm test       # 引擎单测
pnpm build      # 类型检查 + 生产构建
```

## 目录说明

```
src/
├── engine/      # 纯 TS 模拟内核：氮循环、水质、鱼行为、装备模型
├── render/      # Three.js 渲染：玻璃缸、水体、底砂、低模鱼
├── app/         # React 应用外壳
└── shared/      # 共享类型与工具
doc/             # 产品全生命周期文档（见 doc/README.md）
```

## 当前 M0 骨架包含

- 固定步长 + 时间压缩（现实 1 秒 = 游戏 1 分钟）的模拟循环；
- 氮循环最小模型：NH3 → NO2 → NO3、硝化细菌随滤材建立；
- 鱼的状态机：饥饿、压力、健康驱动行为（normal/anxious/sick）；
- 命令：喂食、换水、灯、加热目标；
- Three.js 场景与鱼行为联动，右侧实时水质面板与事件流。

## 后续（按 doc/05-development/roadmap.md）

M1 核心循环可玩 → M2 内容与表现打磨 → M3 灰度发布与留存验证。
