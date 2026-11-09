// 画布录制：基于 canvas.captureStream + MediaRecorder，将缸内画面录制成视频。
// 与渲染器解耦，可独立复用；当前面向 Chromium，输出无声 webm。

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return '';
}

export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';

  // 运行环境是否支持录制
  static isSupported(): boolean {
    return (
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  get recordedType(): string {
    return this.mimeType || this.recorder?.mimeType || 'video/webm';
  }

  start(canvas: HTMLCanvasElement, fps = 30): void {
    if (this.isRecording) return;
    this.chunks = [];
    this.stream = canvas.captureStream(fps);
    this.mimeType = pickMimeType();
    this.recorder = this.mimeType
      ? new MediaRecorder(this.stream, { mimeType: this.mimeType, videoBitsPerSecond: 5_000_000 })
      : new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder) {
        reject(new Error('当前未在录制'));
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recordedType });
        this.cleanup();
        resolve(blob);
      };
      recorder.onerror = () => {
        this.cleanup();
        reject(new Error('视频录制出错'));
      };
      recorder.stop();
    });
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

// 触发浏览器下载，并在点击后回收临时 ObjectURL
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
