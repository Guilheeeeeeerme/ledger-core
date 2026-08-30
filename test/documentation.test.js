const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('English-only repository contract', () => {
  it('documents the complete operator and evaluator journey', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    for (const heading of [
      '## Architecture',
      '## Quick start',
      '## API reference',
      '## Reliability model',
      '## Testing',
      '## Project structure',
      '## Limitations',
      '## License'
    ]) {
      assert.match(readme, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('ships an MIT license', () => {
    const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
    assert.match(license, /MIT License/);
    assert.match(license, /Permission is hereby granted/);
  });
});
