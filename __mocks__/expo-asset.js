// Stub for expo-asset (peer dependency of expo-sqlite, not installed)
module.exports = {
  Asset: {
    fromModule: jest.fn(),
    loadAsync: jest.fn().mockResolvedValue([]),
  },
};
