module.exports = function (api) {
  api.cache(true);
  return {
    // The preset includes the react-native-worklets plugin that reanimated 4 needs.
    presets: ['babel-preset-expo'],
  };
};
