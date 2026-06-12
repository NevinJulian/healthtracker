// Stub for expo-document-picker — the native document picker module is
// unavailable in Jest's node testEnvironment. Returns a cancelled result by
// default; individual tests override getDocumentAsync as needed.

module.exports = {
  getDocumentAsync: jest.fn(() =>
    Promise.resolve({
      canceled: true,
      assets: null,
    })
  ),
};
