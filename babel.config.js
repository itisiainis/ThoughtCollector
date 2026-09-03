module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated's plugin must stay LAST in this list. Anywhere else and you
    // get unexplained "worklet" errors that never mention Babel.
    plugins: ['react-native-reanimated/plugin'],
  };
};
