import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GuideOverlay from '../src/app/components/GuideOverlay';
import { createEngine } from '../src/engine/engine';

// 当前环境未安装 jsdom，交互级 DOM 测试待依赖可用后补充；
// 这里用零依赖的服务端渲染覆盖组件的可见性与文案契约。
const render = (
  engine: ReturnType<typeof createEngine>,
  snapshot = engine.getSnapshot(),
) => renderToStaticMarkup(
  <GuideOverlay engine={engine} snapshot={snapshot} onChanged={() => {}} onOpenShop={() => {}} />,
);

describe('新手引导组件渲染', () => {
  it('未完成引导时显示欢迎步与开始养水按钮', () => {
    const html = render(createEngine());
    expect(html).toContain('欢迎来到知鱼');
    expect(html).toContain('开始养水');
  });

  it('引导完成后不渲染任何内容', () => {
    const engine = createEngine();
    engine.completeGuide();
    expect(render(engine)).toBe('');
  });

  it('五步进度指示始终渲染', () => {
    const html = render(createEngine());
    expect((html.match(/width:18px/g) ?? []).length).toBe(5);
  });
});
