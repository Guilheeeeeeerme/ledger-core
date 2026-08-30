const { createApp } = require('../../dist/app');

async function createHttpApp(deps) {
  const app = await createApp(deps);
  return app.getHttpServer();
}

module.exports = { createHttpApp };
