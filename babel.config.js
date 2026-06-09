module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 54) automatically includes the
    // react-native-worklets Babel plugin required by react-native-reanimated 4.
    presets: ['babel-preset-expo'],
  };
};
