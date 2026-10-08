// Stub for expo-file-system/legacy — the native file-system module is
// unavailable in Jest's node testEnvironment. jest-expo registers its own factory
// for this id, which wins over this file, so directory constants added here are
// never seen; tests that need them mock them inline.

module.exports = {
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  readAsStringAsync: jest.fn(() => Promise.resolve('')),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false, isDirectory: false })),
  deleteAsync: jest.fn(() => Promise.resolve()),
  copyAsync: jest.fn(() => Promise.resolve()),
  moveAsync: jest.fn(() => Promise.resolve()),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
};
