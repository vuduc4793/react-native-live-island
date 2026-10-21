const path = require('path');
const pkg = require('../package.json');

// Link the library from the repo root (not from node_modules), like a monorepo workspace.
module.exports = {
  project: { ios: { automaticPodsInstallation: false } },
  dependencies: {
    [pkg.name]: { root: path.join(__dirname, '..') },
  },
};
