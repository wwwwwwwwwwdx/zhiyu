import { useEffect, useState } from 'react';
import type { Engine, Snapshot } from '../../engine/core/types';
import { track } from '../analytics/tracker';

type Step = 0 | 1 | 2 | 3 | 4;

interface Props {
  engine: Engine;
  snapshot: Snapshot;
  onChanged: () => void;
}

// 新手引导：开缸养水 → 放第一条鱼 → 第一次喂食
export default function GuideOverlay({ engine, snapshot, onChanged }: Props) {
  const [step, setStep] = useState<Step>(0);

  // 依据引擎状态自动推进
  useEffect(() => {
    if (step === 1 && snapshot.nitrogenEstablished) setStep(2);
    if (step === 2 && snapshot.fishes.length > 0) setStep(3);
  }, [step, snapshot]);

  // 目标区块高亮
  useEffect(() => {
    // 步骤 2 高亮底部「商店」按钮，引导用户打开商店放鱼
    const targetId = step === 2 ? 'guide-shop-btn' : null;
    document.querySelectorAll('.guide-highlight').forEach((el) => el.classList.remove('guide-highlight'));
    if (targetId) document.getElementById(targetId)?.classList.add('guide-highlight');
  }, [step]);

  if (snapshot.guideDone) return null;

  const content: Record<Step, { title: string; body: string; action?: () => void; actionText?: string }> = {
    0: {
      title: '欢迎来到知鱼',
      body: '新缸不能直接放鱼，先让过滤器运转、培养硝化细菌，这一步叫"养水"。',
      actionText: '开始养水',
      action: () => { track('cycling_start'); engine.startCycling(); onChanged(); setStep(1); },
    },
    1: {
      title: '养水中',
      body: '硝化细菌正在建立，氨氮会先升高再被分解。请稍候，系统会在完成时提醒你。',
    },
    2: {
      title: '硝化系统已建立',
      body: '现在可以放鱼了。点底部的「商店」，在「小鱼」里选一条喜欢的带回家。',
    },
    3: {
      title: '鱼入缸了',
      body: '它现在有点饿，试试第一次喂食。以后也可以随时在底部操作坞陪它。',
      actionText: '喂食',
      action: () => {
        engine.feed(1);
        onChanged();
        setStep(4);
      },
    },
    4: {
      title: '引导完成',
      body: '鱼缸已经运转起来了。离开时状态会自动保存，随时回来看看它们。',
      actionText: '知道了',
      action: () => {
        track('guide_complete');
        engine.completeGuide();
        onChanged();
      },
    },
  };

  const item = content[step];

  return (
    <>
      <style>{`
        .guide-highlight { outline: 2px solid var(--ocean-500); outline-offset: 3px; box-shadow: 0 0 14px rgba(58,155,189,0.55); border-radius: 14px; }
      `}</style>
      <div
        className="glass"
        style={{
          position: 'absolute', left: 20, bottom: 24, zIndex: 3, width: 300,
          padding: 18, borderRadius: 18,
        }}
      >
        <div style={{ fontSize: 15, marginBottom: 8, fontWeight: 600 }}>{item.title}</div>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 14px', lineHeight: 1.6 }}>{item.body}</p>
        {item.action && (
          <button className="btn btn-primary" onClick={item.action}>
            {item.actionText}
          </button>
        )}
        <div style={{ marginTop: 14, display: 'flex', gap: 5 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              style={{ width: 18, height: 3, borderRadius: 2, background: i <= step ? 'var(--ocean-500)' : 'rgba(84,120,138,0.22)' }}
            />
          ))}
        </div>
      </div>
    </>
  );
}
