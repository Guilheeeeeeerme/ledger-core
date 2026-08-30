const { createApp } = require('../../src/app');

function createHttpApp(deps) {
  return createApp(deps);
}

module.exports = { createHttpApp };
