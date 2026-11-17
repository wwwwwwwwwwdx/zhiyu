export type DomainEvent = string;

export class EventBus {
  private events: DomainEvent[] = [];

  emit(event: DomainEvent): void {
    this.events.push(event);
  }

  // 非破坏性读取：快照可任意次读取，不会吞掉尚未展示的事件
  peek(): DomainEvent[] {
    return [...this.events];
  }

  drain(): DomainEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
