// Stub for expo-file-system/legacy — the native file-system module is
// unavailable in Jest's node testEnvironment.

module.exports = {
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///document/',
  bundleDirectory: 'file:///bundle/',
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  readAsStringAsync: jest.fn(() => Promise.resolve('')),
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false, isDirectory: false })),
  deleteAsync: jest.fn(() => Promise.resolve()),
  copyAsync: jest.fn(() => Promise.resolve()),
  moveAsync: jest.fn(() => Promise.resolve()),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
};
