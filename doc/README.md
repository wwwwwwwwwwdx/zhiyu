# zhiyu 文档中心

zhiyu（知鱼）是一款跨端数字生态缸产品：以真实水族生态模拟为底座，为都市办公人群提供桌面陪伴与解压体验。本目录承载产品全生命周期的全部文档。

## 目录结构

| 目录 | 生命周期阶段 | 内容 |
|---|---|---|
| `01-concept/` | 概念与愿景 | 产品定位、目标用户、市场与竞品分析、商业判断 |
| `02-requirements/` | 需求定义 | PRD、用户故事、核心循环、版本范围（MVP 边界） |
| `03-design/` | 产品设计 | 交互设计、视觉规范、信息架构、数值与系统设计 |
| `04-architecture/` | 技术架构 | 技术选型、架构设计、数据模型、接口与渲染方案 |
| `05-development/` | 研发计划 | 路线图、里程碑、任务拆解、研发规范 |
| `06-quality/` | 质量保障 | 测试策略、测试用例、验收标准 |
| `07-release/` | 发布与运营 | 发布计划、增长与投放、数据监控、复盘 |

## 文档约定

- 语言：中文撰写，技术名词保留英文原词。
- 命名：全小写英文，单词间用连字符，如 `prd-web-v1.md`；同一主题多版本用 `v1/v2` 递增。
- 状态标记：文档头部标注 `草稿 / 评审中 / 已确认 / 已归档`，重大变更需在文末追加变更记录。
- 编号规则：目录前缀数字（01-07）表示生命周期顺序，不表示严格的瀑布流程；项目按迭代推进，文档随迭代持续更新。

## 当前文档清单

- [01-concept/product-vision.md](01-concept/product-vision.md) — 产品愿景与定位
- [01-concept/market-and-competitor-analysis.md](01-concept/market-and-competitor-analysis.md) — 市场与竞品分析
- [02-requirements/prd-web-v1.md](02-requirements/prd-web-v1.md) — Web 端 V1 产品需求文档
- [02-requirements/product-backlog.md](02-requirements/product-backlog.md) — V2 及后续需求 Backlog（B1-B4）
- [03-design/landing-page-design.md](03-design/landing-page-design.md) — 首页设计说明
- [03-design/gltf-asset-spec.md](03-design/gltf-asset-spec.md) — 自制 glTF 资产规范
- [04-architecture/technical-architecture.md](04-architecture/technical-architecture.md) — 总体技术架构与 ADR
- [04-architecture/rendering-approach.md](04-architecture/rendering-approach.md) — 渲染技术定档与降级策略
- [04-architecture/simulation-engine-design.md](04-architecture/simulation-engine-design.md) — 模拟引擎设计
- [05-development/roadmap.md](05-development/roadmap.md) — 产品路线图与里程碑
- [05-development/iteration-m1-notes.md](05-development/iteration-m1-notes.md) — M1 迭代记录
- [05-development/iteration-m2-notes.md](05-development/iteration-m2-notes.md) — M2 迭代记录
- [06-quality/m1-acceptance-review.md](06-quality/m1-acceptance-review.md) — M1 验收评审报告
- [06-quality/m2-performance-acceptance.md](06-quality/m2-performance-acceptance.md) — M2 出口性能验收
