# zhiyu 知鱼

数字生态缸：以真实水族生态模拟为底座的桌面解压产品。本仓库为 Web 端 V1 工程，当前处于 M2 收尾、M3 灰度待启动阶段。

## 技术栈

- TypeScript 5（strict）+ Vite 5 + React 18
- Three.js（裸用，渲染层）、idb（IndexedDB 存档）
- Vitest（引擎与纯函数测试）
- 纯 TS 模拟引擎，零 DOM / 零 Three / 零 React 依赖，可迁移 Worker、可复用于小程序端

## 快速开始

```bash
pnpm install
pnpm dev        # 本地开发
pnpm test       # 引擎与纯函数单测
pnpm build      # 类型检查 + 生产构建
```

## 目录说明

```
src/
├── engine/       # 纯 TS 模拟内核：core（类型与事件）、chemistry（氮循环/水草/藻类）、
│                 # biology（繁殖/品系）、balance（数值与目录）、progression（图鉴/成就）
├── render/       # Three.js 渲染：缸体与水体、GLB 资产加载、游动数学、画质档位、录屏与缩略图
├── app/          # React 外壳：路由、首页、鱼缸页、新手引导、本地埋点
├── persistence/  # IndexedDB 存档，v1→v10 逐级迁移与损坏自愈
└── payment/      # MockPaymentGateway（第一版无真实支付渠道）
doc/              # 产品全生命周期文档
public/           # 25 个 GLB 模型、16 张环境背景、4 张礼遇图标
tools/blender/    # 程序化建模脚本
tests/            # Vitest 用例
```

## 当前能力（M1 + M2 已落地）

- 固定步长与时间压缩（现实 1 秒 = 游戏 1 分钟）、离线推演与回归摘要（封顶 8 游戏小时）
- 氮循环 NH3→NO2→NO3、细菌休眠、水草 / CO2 / 藻类 / pH、放置环境与缸形状联动
- 鱼的状态机、寿命、繁殖选育、稀有品系、混养兼容；12 种鱼、5 种水草、8 件装备
- 金币经济、每日奖励、图鉴成就、卡册分级、月卡与金币包（支付为 Mock）
- 本地自动存档与迁移、5 步新手引导、水质面板与事件流、全屏观赏、一键录屏
- 画质三档（像素比 / 缸内气泡 / 首页微粒）与带回差的自动升降档
- 离线回归分批推演（不阻塞首屏）、`?perf=N` 前台性能自检探针

## 验证状态

| 项目 | 结果 |
|---|---|
| 单元测试 | 20 文件、116 用例通过 |
| TypeScript strict 类型检查 | 通过 |
| 30 FPS+ 与双 Chromium 版本兼容 | 未实测，见 `doc/06-quality/m2-performance-acceptance.md` |
| 真实支付 | 不支持，仅 Mock |

## 后续

M3 灰度发布与留存验证（次留 ≥35%、7 留 ≥15%、单次时长 ≥8 分钟），路线图见 `doc/05-development/roadmap.md`。

说明：`doc/05-development/` 迭代记录与 `doc/06-quality/` 验收报告为历史时点快照，不随代码同步更新；当前实现以源码为准，架构文档首部附有实现对照表。
