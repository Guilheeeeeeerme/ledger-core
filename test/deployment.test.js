const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'stack.manifest.json'), 'utf8'));

describe('deployment contract', () => {
  it('defines compose project name and declared services with healthchecks', () => {
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    assert.match(compose, new RegExp(`name: ${manifest.composeName}`));
    for (const service of manifest.composeServices) {
      assert.match(compose, new RegExp(`${service}:`));
    }
    assert.match(compose, /3005:3005/);
    assert.match(compose, /9092:9092/);
    assert.match(compose, /build:[\s\S]*?context: \.[\s\S]*?network: host/);
    assert.equal((compose.match(/healthcheck:/g) || []).length, manifest.composeServices.length);
    assert.doesNotMatch(compose, /rabbitmq/);
  });

  it('documents startup and both observable URLs', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, /docker compose up --build/);
    assert.match(readme, /http:\/\/localhost:3005/);
    assert.match(readme, /localhost:9092/);
  });
});
