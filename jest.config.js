module.exports = {
  preset: 'jest-expo',
  // Override testEnvironment to node to avoid jest-expo's custom env adding
  // more winter-runtime surface area.
  testEnvironment: 'node',
  moduleNameMapper: {
    // expo/src/winter installs __ExpoImportMetaRegistry via a getter that
    // lazily requires runtime.native, which uses dynamic import() — blocked
    // by Jest 30. Stub the whole namespace so setup.js is a no-op.
    '^expo/src/winter(/.*)?$': '<rootDir>/__mocks__/expo-winter.js',
    '^expo-sqlite(/.*)?$': '<rootDir>/__mocks__/expo-sqlite.js',
    '^expo-asset(/.*)?$': '<rootDir>/__mocks__/expo-asset.js',
    '^@expo/vector-icons(/.*)?$': '<rootDir>/__mocks__/@expo/vector-icons.js',
  },
};
