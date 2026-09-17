import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the production grouping section without the store's browser imports.
const source = fs.readFileSync(new URL('../src/state/fontStore.ts', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('const FOUNDRY_SUFFIXES'));
const exports = {};
vm.runInNewContext(ts.transpileModule(section, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { foundryGroupsFor } = exports;
const families = names => new Map(names.map((foundry, i) => [String(i), { foundry }]));

test('groups spelling and corporate suffix variants without changing metadata', () => {
  const input = families(['Dalton Maag', 'Dalton Maag', 'DaltonMaag', 'Dalton Maag Ltd.']);
  const groups = foundryGroupsFor(input);
  for (const name of groups.keys()) assert.equal(groups.get(name), 'Dalton Maag');
  assert.equal(input.get('3').foundry, 'Dalton Maag Ltd.');
  assert.equal(foundryGroupsFor(input), groups);
});

test('keeps similar, prefix, suffix-only and non-Latin names distinct', () => {
  const names = ['Alpha Type', 'Alpha Types', 'Alpha Type Studio', 'Ltd', 'Inc',
    'AS Design', 'Design', '字体', '字體', '!!!', '???'];
  const groups = foundryGroupsFor(families(names));
  assert.equal(new Set(groups.values()).size, names.length);
});

test('canonical grouping does not depend on input order', () => {
  const names = ['Example Ltd.', 'EXAMPLE', 'Example'];
  const first = foundryGroupsFor(families(names));
  const second = foundryGroupsFor(families([...names].reverse()));
  for (const name of names) assert.equal(first.get(name), second.get(name));
});
