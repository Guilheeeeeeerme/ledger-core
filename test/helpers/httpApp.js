const { createApp } = require('../../src/app');

async function createHttpApp(deps) {
  return createApp(deps);
}

module.exports = { createHttpApp };
