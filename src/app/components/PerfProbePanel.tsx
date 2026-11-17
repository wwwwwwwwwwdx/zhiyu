import { useEffect, useState } from 'react';
import { startPerfProbe, type PerfReport } from '../analytics/perfProbe';

// 前台性能验收面板：仅 URL 带 ?perf=N 时采集并展示结果，正常访问不渲染任何内容
export default function PerfProbePanel() {
  const [report, setReport] = useState<PerfReport | null>(null);

  useEffect(() => {
    const seconds = Number(new URLSearchParams(window.location.search).get('perf') ?? 0);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) return undefined;
    return startPerfProbe(seconds, setReport);
  }, []);

  if (!report) return null;

  return (
    <div
      className="glass"
      style={{
        position: 'absolute', right: 20, bottom: 20, zIndex: 5, width: 340,
        padding: 16, borderRadius: 12, fontSize: 13, lineHeight: 1.7,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>性能自检 · {report.durationSeconds} 秒</div>
      <div>平均 {report.avgFps} FPS · 最差 1 秒 {report.minFps} FPS</div>
      <div>P95 帧时 {report.p95FrameMs} ms · 慢帧 {report.slowFrames}/{report.frames}</div>
      <div>DPR {report.devicePixelRatio} · {report.webglRenderer}</div>
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button
          className="btn btn-sm"
          onClick={() => navigator.clipboard?.writeText(JSON.stringify(report, null, 2))}
        >复制结果</button>
        <button className="btn btn-sm" onClick={() => setReport(null)}>关闭</button>
      </div>
    </div>
  );
}
