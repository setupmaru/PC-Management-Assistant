const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file)
const React = require('react')
const { create, act } = require('react-test-renderer')
global.IS_REACT_ACT_ENVIRONMENT = true
const Card = require('../src/renderer/components/Dashboard/BootOptimizationCard.tsx').default
const empty = { checkedAt: 1, latestBoot: null, averageBootSeconds: null, improvementSeconds: null, bootHistory: [], startupItems: [{ id: 'a', name: 'Example App', type: 'registry', measuredDelaySeconds: null, manageable: true, enabled: true }], changes: [], restorePointAutoCreate: true, bootLogStatus: 'no-data' }
async function mount(snapshot = empty, refresh = async () => ({ success: true, data: empty })) {
  let update
  global.window = { api: { diagnostics: { getBootOptimization: async () => ({ success: true, data: snapshot }), refreshBootOptimization: refresh, onBootUpdate: cb => { update = cb; return () => {} } } } }
  let root
  await act(async () => { root = create(React.createElement(Card)) })
  return { root, update }
}
test('completed collection without measurements stops loading and opens all startup items', async () => {
  const { root } = await mount()
  assert.doesNotMatch(JSON.stringify(root.toJSON()), /분석하고 있습니다/)
  assert.match(JSON.stringify(root.toJSON()), /부팅 성능 기록이 없습니다/)
  await act(async () => root.root.findAllByType('button').find(b => b.props.children === '상세 · 관리').props.onClick())
  assert.match(JSON.stringify(root.toJSON()), /Example App/)
  await act(async () => root.unmount())
})
function service(run) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/main/diagnostics/boot-optimizer.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { module, exports: module.exports, require: name => name === 'electron' ? { app: {} } : name === '../utils/powershell' ? { runPowerShell: run } : require(name) })
  return new module.exports.BootOptimizerService()
}
for (const [status, message] of [['disabled', /로그가 꺼져 있습니다/], ['access-denied', /관리자 권한/], ['error', /조회에 실패/]]) {
  test(`card explains ${status} instead of remaining in loading state`, async () => {
    const { root } = await mount({ ...empty, bootLogStatus: status })
    assert.match(JSON.stringify(root.toJSON()), message)
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /분석하고 있습니다/)
    await act(async () => root.unmount())
  })
}
test('missing initial snapshot waits for refresh, and failed refresh can be retried', async () => {
  let finish
  let calls = 0
  const { root } = await mount(null, () => { calls++; return new Promise(resolve => { finish = resolve }) })
  assert.equal(calls, 1)
  assert.match(JSON.stringify(root.toJSON()), /분석하고 있습니다/)
  await act(async () => finish({ success: false, error: 'Timed out' }))
  assert.match(JSON.stringify(root.toJSON()), /Timed out/)
  assert.doesNotMatch(JSON.stringify(root.toJSON()), /분석하고 있습니다/)
  await act(async () => { root.root.findAllByType('button').find(b => b.props.children === '새로 고침').props.onClick() })
  await act(async () => finish({ success: true, data: empty }))
  assert.equal(calls, 2)
  assert.match(JSON.stringify(root.toJSON()), /부팅 성능 기록이 없습니다/)
  assert.doesNotMatch(JSON.stringify(root.toJSON()), /Timed out|분석하고 있습니다/)
  await act(async () => root.unmount())
})
test('boot history without matched item delays is a completed measurement', async () => {
  const { root } = await mount({ ...empty, bootLogStatus: 'ready', latestBoot: { totalSeconds: 25 } })
  assert.match(JSON.stringify(root.toJSON()), /25.0초/)
  assert.match(JSON.stringify(root.toJSON()), /연결된 실측 지연 기록이 없습니다/)
  assert.doesNotMatch(JSON.stringify(root.toJSON()), /분석하고 있습니다/)
  await act(async () => root.unmount())
})
test('boot log diagnostics preserve independently collected startup items', async () => {
  const boot = service(async () => JSON.stringify({ BootLogStatus: 'access-denied', BootLogError: 'Access is denied', StartupItems: [{ Name: 'App', Type: 'registry', Location: 'HKCU:Run', EntryName: 'App' }] }))
  const snapshot = await boot.refresh()
  assert.equal(snapshot.bootLogStatus, 'access-denied')
  assert.equal(snapshot.bootLogError, 'Access is denied')
  assert.equal(snapshot.startupItems.length, 1)
  assert.equal(snapshot.latestBoot, null)
})
test('initial collection failure publishes a terminal snapshot and a later refresh recovers', async () => {
  let fail = true
  const boot = service(async () => { if (fail) throw new Error('timeout'); return JSON.stringify({ BootEvents: [{ Timestamp: '2026-11-20T01:00:00Z', BootTime: '25000', MainPathBootTime: '20000', BootPostBootTime: '5000' }] }) })
  const updates = []
  boot.onUpdate = data => updates.push(data)
  const failed = await boot.refresh()
  assert.equal(failed.bootLogStatus, 'error')
  assert.match(failed.collectionError, /timeout/)
  assert.equal(updates.length, 1)
  assert.equal(boot.getSnapshot(), failed)
  fail = false
  const recovered = await boot.refresh()
  assert.equal(recovered.collectionError, undefined)
  assert.equal(recovered.bootLogStatus, 'ready')
  assert.equal(recovered.latestBoot.totalSeconds, 25)
  assert.equal(recovered.latestBoot.loginSeconds, 20)
  assert.equal(recovered.latestBoot.postLoginSeconds, 5)
})
test('concurrent refreshes wait for the same collection, including when cached data exists', async () => {
  let finish
  let calls = 0
  const boot = service(() => { calls++; return new Promise(resolve => { finish = resolve }) })
  boot.snapshot = empty
  const first = boot.refresh()
  const second = boot.refresh()
  assert.equal(first, second)
  assert.equal(calls, 1)
  finish('{}')
  assert.notEqual(await second, empty)
  await first
})
test('missing and empty durations do not become fake zero-second boot measurements', async () => {
  const boot = service(async () => JSON.stringify({ BootEvents: [null, '', ' '].map(BootTime => ({ BootTime, Timestamp: '2026-11-20T01:00:00Z' })) }))
  const snapshot = await boot.refresh()
  assert.equal(snapshot.latestBoot, null)
  assert.equal(snapshot.bootHistory.length, 0)
})
