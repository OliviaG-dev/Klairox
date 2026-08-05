export type EventMap = Record<string, unknown>;
export type EventListener<TPayload> = (payload: TPayload) => void;
export type Unsubscribe = () => void;

/**
 * Minimal typed emitter. It keeps the engine usable from any host (Angular, React,
 * CLI, desktop) without the host having to poll or subclass anything.
 */
export class EventBus<TEvents extends EventMap> {
  private readonly listeners = new Map<
    keyof TEvents,
    Set<EventListener<never>>
  >();

  on<TKey extends keyof TEvents>(
    event: TKey,
    listener: EventListener<TEvents[TKey]>,
  ): Unsubscribe {
    const existing =
      this.listeners.get(event) ?? new Set<EventListener<never>>();
    existing.add(listener as EventListener<never>);
    this.listeners.set(event, existing);

    return () => this.off(event, listener);
  }

  once<TKey extends keyof TEvents>(
    event: TKey,
    listener: EventListener<TEvents[TKey]>,
  ): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      listener(payload);
    });

    return unsubscribe;
  }

  off<TKey extends keyof TEvents>(
    event: TKey,
    listener: EventListener<TEvents[TKey]>,
  ): void {
    const existing = this.listeners.get(event);
    if (existing === undefined) {
      return;
    }

    existing.delete(listener as EventListener<never>);
    if (existing.size === 0) {
      this.listeners.delete(event);
    }
  }

  /**
   * Notifies every listener even if one throws, then reports the failures together.
   * A broken subscriber must not silently swallow the others.
   */
  emit<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]): void {
    const existing = this.listeners.get(event);
    if (existing === undefined) {
      return;
    }

    const failures: unknown[] = [];

    for (const listener of [...existing]) {
      try {
        (listener as EventListener<TEvents[TKey]>)(payload);
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `${failures.length} listener(s) of "${String(event)}" threw`,
      );
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
