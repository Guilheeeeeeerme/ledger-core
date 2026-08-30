const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);
const textExtensions = new Set(['.js', '.json', '.md', '.sql', '.html', '.css', '.yml', '.yaml']);

function textFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    // This test contains the detection vocabulary, so it must not scan itself.
    if (ignoredDirectories.has(entry.name)
      || entry.name === 'package-lock.json'
      || entry.name === 'documentation.test.js') return [];
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(entryPath);
    return textExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

describe('English-only repository contract', () => {
  it('contains no known Portuguese prose in code or documentation', () => {
    const portuguese = /[áàâãéêíóôõúç]|\b(objetivo|escopo|conta|contas|saldo|saldos|transferência|transação|lançamento|histórico|descrição|origem|destino|valor|pagamento|demonstração|executar|requisito|decisões|estrutura|testes|criar|implementar|conectando|atualizar|nenhuma|falha|usuário|aplicação|serviço|aprovado)\b/i;
    const violations = textFiles(root).filter((file) => portuguese.test(fs.readFileSync(file, 'utf8')));
    assert.deepEqual(violations.map((file) => path.relative(root, file)), []);
  });

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
