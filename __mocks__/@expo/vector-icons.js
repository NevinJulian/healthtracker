// Stub for @expo/vector-icons — icon families pull in native font loading
// which is unavailable in Jest's node testEnvironment. Return trivial function
// components for every icon family used in the app.
const React = require('react');

function stubIcon() {
  return null;
}

module.exports = {
  Ionicons: stubIcon,
  Feather: stubIcon,
  MaterialIcons: stubIcon,
  FontAwesome: stubIcon,
  FontAwesome5: stubIcon,
  AntDesign: stubIcon,
  Entypo: stubIcon,
  EvilIcons: stubIcon,
  Foundation: stubIcon,
  MaterialCommunityIcons: stubIcon,
  Octicons: stubIcon,
  SimpleLineIcons: stubIcon,
  Zocial: stubIcon,
  createIconSet: jest.fn(() => stubIcon),
  createIconSetFromFontello: jest.fn(() => stubIcon),
  createIconSetFromIcoMoon: jest.fn(() => stubIcon),
};
