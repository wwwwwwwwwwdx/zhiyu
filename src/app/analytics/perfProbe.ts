// 前台性能验收探针：URL 带 ?perf=N 时采集 N 秒帧数据，结果可复制进验收报告。
// 仅在显式传参时启动，正常访问不产生任何开销。

export interface PerfReport {
  durationSeconds: number;
  frames: number;
  avgFps: number;
  minFps: number;     // 最差 1 秒窗口内的帧数
  p95FrameMs: number;
  maxFrameMs: number;
  slowFrames: number; // 帧间隔超过 33.3ms 的帧数
  devicePixelRatio: number;
  webglRenderer: string;
  userAgent: string;
  capturedAt: string;
}

export interface PerfMeta {
  seconds: number;
  devicePixelRatio: number;
  webglRenderer: string;
  userAgent: string;
  capturedAt: string;
}

// 纯统计逻辑，与 DOM 采集分离，可独立单测
export function summarizeFrames(deltas: number[], windowFps: number[], meta: PerfMeta): PerfReport {
  const total = deltas.reduce((sum, d) => sum + d, 0);
  const sorted = [...deltas].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
  const max = sorted.length ? sorted[sorted.length - 1] : 0;
  return {
    durationSeconds: meta.seconds,
    frames: deltas.length,
    avgFps: total > 0 ? Math.round((deltas.length * 1000) / total) : 0,
    minFps: windowFps.length ? Math.min(...windowFps) : 0,
    p95FrameMs: Number(p95.toFixed(1)),
    maxFrameMs: Number(max.toFixed(1)),
    slowFrames: deltas.filter((d) => d > 1000 / 30).length,
    devicePixelRatio: meta.devicePixelRatio,
    webglRenderer: meta.webglRenderer,
    userAgent: meta.userAgent,
    capturedAt: meta.capturedAt,
  };
}

function readWebglRenderer(): string {
  const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) return 'none';
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return 'unavailable';
  const ext = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
  return ext
    ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
}

export function startPerfProbe(seconds: number, onDone: (report: PerfReport) => void): () => void {
  const deltas: number[] = [];
  const windowFps: number[] = [];
  let raf = 0;
  let last = 0;
  let startedAt = 0;
  let windowStart = 0;
  let windowFrames = 0;
  let cancelled = false;

  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    onDone(summarizeFrames(deltas, windowFps, {
      seconds,
      devicePixelRatio: window.devicePixelRatio,
      webglRenderer: readWebglRenderer(),
      userAgent: navigator.userAgent,
      capturedAt: new Date().toISOString(),
    }));
  };

  const loop = (now: number) => {
    if (cancelled) return;
    if (!startedAt) {
      startedAt = now;
      windowStart = now;
      last = now;
    }
    const delta = now - last;
    last = now;
    // 过滤后台挂起造成的超长间隔，避免污染帧时统计
    if (delta > 0 && delta < 1000) {
      deltas.push(delta);
      windowFrames += 1;
    }
    if (now - windowStart >= 1000) {
      windowFps.push(windowFrames);
      windowStart = now;
      windowFrames = 0;
    }
    if (now - startedAt >= seconds * 1000) {
      finish();
      return;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
