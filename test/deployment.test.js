const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'stack.manifest.json'), 'utf8'));

describe('deployment contract', () => {
  it('defines compose project name and declared services with healthchecks', () => {
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    assert.match(compose, new RegExp(`^name: ${manifest.composeName}$`, 'm'));
    for (const service of manifest.composeServices) {
      assert.match(compose, new RegExp(`^\\s+${service}:`, 'm'));
    }
    assert.equal(manifest.composeServices.includes('rabbitmq'), false);
    assert.doesNotMatch(compose, /rabbitmq/);
    assert.match(compose, /3000:3000/);
    if (manifest.composeServices.includes('redis')) {
      assert.match(compose, /6379/);
    }
    assert.match(compose, /build:[\s\S]*?context: \.[\s\S]*?network: host/);
    assert.equal((compose.match(/healthcheck:/g) || []).length, manifest.composeServices.length);
  });

  it('documents startup and the dashboard URL without RabbitMQ management', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, /docker compose up --build/);
    assert.match(readme, /http:\/\/localhost:3000/);
    assert.doesNotMatch(readme, /15672/);
    assert.match(readme, /BullMQ/);
    assert.match(readme, /Redis/);
  });
});
