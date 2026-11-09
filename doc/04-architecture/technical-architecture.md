# 技术架构方案

状态：评审中
最后更新：2026-11-05

## 一、技术选型总表

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript 5（strict） | 生态模拟涉及大量数值模型，强类型保障可维护性 |
| 构建 | Vite 6 | 启动快、ESM 原生、Three.js 与 Web Worker 支持成熟 |
| UI 框架 | React 18 | 仅负责 HUD/面板/引导等界面外壳，生态最大 |
| 3D 渲染 | Three.js（裸用，非 R3F） | 渲染循环与模拟引擎直接集成，可控性高，避免声明式 reconciler 开销 |
| UI 状态 | Zustand | 轻量，订阅引擎快照，避免全量重渲染 |
| 存档 | IndexedDB（idb 封装）+ JSON 导出 | 支持离线快照与大体积时序数据 |
| 测试 | Vitest | 与 Vite 同构，引擎数值模型单测/回归 |
| 规范 | ESLint + Prettier + TypeScript 严格模式 | 统一交付质量 |
| 包管理 | pnpm | 磁盘占用小、依赖严格 |

## 二、分层架构

```
┌─────────────────────────────────────────────┐
│ app (React)：布局、HUD、面板、引导、设置      │
│      ▲ 订阅快照/派发命令                      │
├─────────────────────────────────────────────┤
│ ui-state (Zustand)：视图态与引擎快照缓存       │
├──────────────────────┬──────────────────────┤
│ render (Three.js)    │ engine (纯 TS，零 DOM) │
│ 场景/缸/水/鱼表现     │ 生态模拟/实体/装备/事件 │
│      ▲ 读取状态       │      ▲ 命令/事件        │
└──────┴───────────────┴──────────────────────┘
         │ persistence (IndexedDB) / telemetry (埋点)
```

核心原则：**engine 是纯 TypeScript 内核，不依赖 React、Three.js 与 DOM**。render 与 app 都是 engine 的消费者。这保证引擎可单测、可换渲染端（未来小程序复用同一套模型）、可在 Web Worker 中独立运行。

## 三、工程目录结构

```
zhiyu/
├── doc/
├── public/
├── src/
│   ├── main.tsx                # 应用入口
│   ├── app/                    # React 外壳、路由、全局布局
│   ├── engine/                 # 纯 TS 模拟内核
│   │   ├── core/               # World、Clock、Scheduler、EventBus、Entity
│   │   ├── chemistry/          # 氮循环、水质参数与反应模型
│   │   ├── organisms/          # 鱼等生物实体、行为状态机
│   │   ├── equipment/          # 过滤器/灯/加热棒等装备模型
│   │   └── offline/            # 离线推演与摘要生成
│   ├── render/                 # Three.js 渲染层
│   │   ├── scene/              # 缸、水体、灯光、底砂、气泡
│   │   ├── entities/           # 生物的渲染表现与插值
│   │   └── Renderer.ts         # 渲染循环、降帧策略
│   ├── ui/                     # React 组件（HUD、水质面板、装备面板）
│   ├── persistence/            # IndexedDB 存档、自动保存、导入导出
│   ├── telemetry/              # 埋点与事件上报
│   └── shared/                 # 类型、常量、数值工具
├── tests/                      # Vitest 引擎测试
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── eslint.config.js
└── README.md
```

## 四、关键架构决策（ADR）

### ADR-01：裸 Three.js，不使用 @react-three/fiber

- 模拟产品需要对固定步长循环、插值、降帧做精细控制，裸 Three.js 的命令式循环与 engine 调度天然对齐。
- React 仅在 UI 层，通过 Zustand 订阅节流后的引擎快照（如 2-4 次/秒），避免每帧触发 React 渲染。

### ADR-02：单包分层，不引入 monorepo 与重型 ECS

- V1 团队与代码规模小，pnpm workspace 属过度设计；目录分层已强制 engine 纯净性。
- 不引入 ECS 库，采用轻量 Entity + 组件对象组合；当实体类型超过当前规模再评估。

### ADR-03：固定逻辑步长 + 渲染插值

- 逻辑固定步长（默认 1 游戏秒/tick），requestAnimationFrame 驱动累加器，渲染层做状态插值，保证数值稳定与可复现。
- 详见 `simulation-engine-design.md`。

### ADR-04：引擎可迁移 Worker，预留小程序端

- engine 无 DOM 依赖，性能吃紧时整体移入 Web Worker，主线程仅渲染；未来小程序端重新实现 render 层即可复用引擎模型。

### ADR-05：本地优先存档，V1 不绑定强账号

- 自动快照写 IndexedDB，关键事件触发额外保存点；支持 JSON 导出兜底。V2 再做账号与云同步。

## 五、数据流

1. 用户操作（喂食/换水/调装备）→ app 派发 **Command** 到 engine；
2. engine 固定步长推进，更新实体与水质，产生 **DomainEvent**；
3. 引擎按节流频率输出 **Snapshot** → Zustand → React 面板；render 每帧直接读取 engine 实时状态做插值；
4. persistence 订阅事件做自动存档；telemetry 订阅匿名事件做埋点。

## 六、质量门

- 引擎：核心数值模型 100% 单测覆盖，氮循环公式带基准回归数据；
- 类型：strict 模式零 any 逃逸（共享层例外需评审）；
- 性能：集显办公本 30 FPS+，后台标签页自动暂停/降帧；
- 提交：ESLint + Prettier + 类型检查 + 单测通过后方可合入。
