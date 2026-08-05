import { EventBus } from './event-bus.js';

type TestEvents = {
  ping: { readonly value: number };
};

describe('EventBus', () => {
  it('delivers a payload to every subscriber', () => {
    const bus = new EventBus<TestEvents>();
    const received: number[] = [];

    bus.on('ping', ({ value }) => received.push(value));
    bus.on('ping', ({ value }) => received.push(value * 2));
    bus.emit('ping', { value: 3 });

    expect(received).toEqual([3, 6]);
  });

  it('stops delivering after the returned unsubscribe is called', () => {
    const bus = new EventBus<TestEvents>();
    const received: number[] = [];

    const unsubscribe = bus.on('ping', ({ value }) => received.push(value));
    unsubscribe();
    bus.emit('ping', { value: 1 });

    expect(received).toEqual([]);
  });

  it('delivers a "once" subscription a single time', () => {
    const bus = new EventBus<TestEvents>();
    const received: number[] = [];

    bus.once('ping', ({ value }) => received.push(value));
    bus.emit('ping', { value: 1 });
    bus.emit('ping', { value: 2 });

    expect(received).toEqual([1]);
  });

  it('notifies the remaining listeners even when one throws, then reports the failure', () => {
    const bus = new EventBus<TestEvents>();
    const received: number[] = [];

    bus.on('ping', () => {
      throw new Error('listener exploded');
    });
    bus.on('ping', ({ value }) => received.push(value));

    expect(() => bus.emit('ping', { value: 7 })).toThrow(AggregateError);
    expect(received).toEqual([7]);
  });

  it('does nothing when nobody listens', () => {
    const bus = new EventBus<TestEvents>();

    expect(() => bus.emit('ping', { value: 1 })).not.toThrow();
  });
});
