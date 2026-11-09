export type DomainEvent = string;

export class EventBus {
  private events: DomainEvent[] = [];

  emit(event: DomainEvent): void {
    this.events.push(event);
  }

  drain(): DomainEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
