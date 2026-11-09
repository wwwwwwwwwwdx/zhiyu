// 轻量埋点：定义核心动作事件，sink 可插拔。当前只做本地采集，不依赖外部服务，
// M3 接入真实数据后端时只需新增一个 HttpSink，业务埋点代码无需改动。

export type AnalyticsEventName =
  | 'session_start'
  | 'cycling_start'
  | 'guide_complete'
  | 'buy_fish'
  | 'buy_plant'
  | 'buy_equipment'
  | 'install_equipment'
  | 'feed'
  | 'water_change'
  | 'toggle_light'
  | 'enter_fullscreen';

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  at: number;
  props?: Record<string, string | number | boolean>;
}

export interface AnalyticsSink {
  send(event: AnalyticsEvent): void;
}

// 本地存储 sink：保留最近 200 条，支持导出供看板/调试
export class LocalStorageSink implements AnalyticsSink {
  private readonly key = 'zhiyu-analytics';
  private readonly max = 200;

  send(event: AnalyticsEvent): void {
    try {
      const list = this.read();
      list.push(event);
      const trimmed = list.slice(-this.max);
      localStorage.setItem(this.key, JSON.stringify(trimmed));
    } catch {
      // 存储不可用（隐私模式/配额）时静默降级，不影响产品
    }
  }

  read(): AnalyticsEvent[] {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? (JSON.parse(raw) as AnalyticsEvent[]) : [];
    } catch {
      return [];
    }
  }

  clear(): void {
    localStorage.removeItem(this.key);
  }
}

// 全应用共用一个 sink，默认本地采集
let sink: AnalyticsSink = new LocalStorageSink();

export function setAnalyticsSink(next: AnalyticsSink): void {
  sink = next;
}

export function track(name: AnalyticsEventName, props?: AnalyticsEvent['props']): void {
  sink.send({ name, at: Date.now(), props });
}

// 统计某事件的累计次数，供本地数据看板使用
export function countEvent(name: AnalyticsEventName): number {
  return (sink as LocalStorageSink).read().filter((e) => e.name === name).length;
}
