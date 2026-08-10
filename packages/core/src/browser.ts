/**
 * Browser-safe surface of `@klairox/core`.
 *
 * Excludes disk I/O, Sharp/export paths and other Node-only modules so the web
 * editor can resolve selections and evaluate constraints without polyfills.
 */
export * from './lib/errors.js';
export * from './lib/events/engine-events.js';
export * from './lib/events/event-bus.js';
export * from './lib/composition/composition.types.js';
export * from './lib/plugin/plugin.types.js';
export * from './lib/rules/rule-engine.js';
export * from './lib/selection/resolution-order.js';
export * from './lib/selection/resolve-selection.js';
export * from './lib/selection/selection.types.js';
