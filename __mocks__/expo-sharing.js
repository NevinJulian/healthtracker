// Stub for expo-sharing — the native sharing module is unavailable in Jest's
// node testEnvironment. All functions resolve as no-ops so tests that import
// backup-aware modules don't crash.

module.exports = {
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
};
