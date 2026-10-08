const DIRECTORY_CONSTANTS = ['cacheDirectory', 'documentDirectory', 'bundleDirectory'];

describe('expo-file-system/legacy mock', () => {
  it('does not declare directory constants the preset mock would shadow', () => {
    const repoMock = jest.requireActual('../../__mocks__/expo-file-system/legacy.js');
    const declared = Object.keys(repoMock);
    for (const name of DIRECTORY_CONSTANTS) {
      expect(declared).not.toContain(name);
    }
  });

  it('resolves the module id to the preset mock, which has no directory values', () => {
    const legacy = require('expo-file-system/legacy');
    expect(legacy.downloadAsync).toBeDefined();
    expect(legacy.documentDirectory).toBeUndefined();
  });
});
