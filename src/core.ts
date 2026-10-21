// React-Native-free entry point: primitives + renderTemplate. Safe to import on a Node server
// (e.g. to build APNs Live Activity payloads): `react-native-live-island/src/core`.
export * from './primitives';
export { renderTemplate, encodePayload } from './template';
export type { LiveActivityTemplate, Region, TemplateStyle } from './template';
export * from './schema';
