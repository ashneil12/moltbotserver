// Vitest production shim — provides no-op stubs for vitest symbols
// that are imported by test-utility modules re-exported through the
// plugin-sdk barrel (src/plugin-sdk/index.ts).
//
// These test utilities are never invoked at runtime, but the bundler
// includes their import statements. This shim prevents ERR_MODULE_NOT_FOUND
// when vitest is pruned from production node_modules.

const noop = () => {};

export const vi = new Proxy({}, { get: () => noop });
export const expect = () => new Proxy({}, { get: () => expect });
export const describe = noop;
export const it = noop;
export const test = noop;
export const beforeEach = noop;
export const afterEach = noop;
export const beforeAll = noop;
export const afterAll = noop;
export const suite = noop;
export const bench = noop;
export const assert = noop;
