const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('deployment contract', () => {
  it('defines app, PostgreSQL and RabbitMQ services with healthchecks', () => {
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    for (const service of ['app:', 'postgres:', 'rabbitmq:']) assert.match(compose, new RegExp(service));
    assert.match(compose, /3000:3000/);
    assert.match(compose, /15672:15672/);
    assert.match(compose, /build:[\s\S]*?context: \.[\s\S]*?network: host/);
    assert.equal((compose.match(/healthcheck:/g) || []).length, 3);
  });

  it('documents startup and both observable URLs', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, /docker compose up --build/);
    assert.match(readme, /http:\/\/localhost:3000/);
    assert.match(readme, /http:\/\/localhost:15672/);
  });
});
