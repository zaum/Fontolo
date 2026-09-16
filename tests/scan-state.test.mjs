import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function compile(source, require) {
  const exports = {};
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require, setTimeout, clearTimeout, console });
  return exports;
}
function loadStore(ipc) {
  const source = process.env.ZFM_TEST_HEAD
    ? execFileSync('git', ['show', 'HEAD:src/state/fontStore.ts'], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(new URL('src/state/fontStore.ts', root), 'utf8');
  const queue = compile(fs.readFileSync(new URL('src/lib/scanQueue.ts', root), 'utf8'), () => {});
  function create(initializer) {
    let state;
    const get = () => state;
    const set = patch => { state = { ...state, ...patch }; };
    state = initializer(set, get);
    return { getState: get, setState: set };
  }
  const noop = () => {};
  const modules = {
    zustand: { create },
    '../lib/scanQueue': queue,
    '@tauri-apps/api/event': { listen: async () => noop },
    '../lib/ipc': { ipc },
    '../lib/accent': { loadAccent: () => 'blue' },
    '../lib/i18n': { getLocalePref: () => 'en', t: key => key },
    '../design/primitives/Toast': { toast: { error: noop, success: noop } },
  };
  return compile(source, name => modules[name] ?? {}).useFontStore;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a change during a scan must survive the stale result and trigger a trailing scan', async () => {
  const oldScan = deferred();
  let calls = 0;
  let scanning = false;
  const oldFonts = [{ family: 'Existing', active: true }];
  const newFonts = [...oldFonts, { family: 'Imported', active: false }];
  const store = loadStore({
    // Model the existing backend single-flight behavior: simultaneous calls
    // join the old scan, including calls made after the library was changed.
    scanFonts: () => {
      calls++;
      if (calls === 1) {
        scanning = true;
        return oldScan.promise.finally(() => { scanning = false; });
      }
      return scanning ? oldScan.promise : Promise.resolve(newFonts);
    },
    getTags: async () => ({}), getCollections: async () => ({}),
    getFavorites: async () => [], getNotes: async () => ({}), listTrash: async () => [],
  });
  const first = store.getState().rescan();
  await tick();
  store.setState({ fonts: newFonts, lastImported: ['Imported'] });
  const afterChange = store.getState().rescan();
  await tick();
  oldScan.resolve(oldFonts);
  await Promise.all([first, afterChange]);
  assert.equal(store.getState().fonts.some(f => f.family === 'Imported'), true,
    'the stale in-flight scan must not remove the newly imported font');
  assert.equal(store.getState().lastImported.includes('Imported'), true);
  assert.equal(calls, 2, 'exactly one trailing scan is required');
});

test('ScanQueue coalesces a burst and rejects obsolete commits', async () => {
  const { ScanQueue } = compile(fs.readFileSync(new URL('src/lib/scanQueue.ts', root), 'utf8'), () => {});
  const gate = deferred();
  const commits = [];
  let runs = 0;
  const queue = new ScanQueue(async isCurrent => {
    const run = ++runs;
    if (run === 1) await gate.promise;
    if (isCurrent()) commits.push(run);
  });
  const first = queue.request();
  await tick();
  const pending = [queue.request(), queue.request(), queue.request()];
  gate.resolve();
  await Promise.all([first, ...pending]);
  assert.deepEqual(commits, [2]);
  assert.equal(runs, 2);
});
