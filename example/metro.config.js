const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const escape = (p) => p.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');

/**
 * The library lives one folder up (../src). Watch it, resolve it by name, and make sure
 * react / react-native always come from the example's node_modules (the root has its own copies for typechecking).
 * https://reactnative.dev/docs/metro
 */
const config = {
  projectRoot: __dirname,
  watchFolders: [root],
  resolver: {
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
    extraNodeModules: { [pkg.name]: root },
    blockList: [new RegExp(`^${escape(path.join(root, 'node_modules'))}\\/.*$`)],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
