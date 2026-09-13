const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
function load(file, requireFn = require) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: requireFn, process })
  return module.exports
}
test('typed preload bridge invokes account settings IPC without identity payload', async () => {
  let api; const calls = []
  load('src/preload/preload.ts', name => name === 'electron' ? { contextBridge: { exposeInMainWorld: (_, value) => { api = value } }, ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ success: true }) } } } : {})
  assert.ok(api.accountSettings)
  await api.accountSettings.get(); await api.accountSettings.update('gpt-5.5')
  assert.equal(JSON.stringify(calls), JSON.stringify([['accountSettings:get'], ['accountSettings:update', 'gpt-5.5']]))
})
test('IPC settings forwards through authenticated transport and returns server errors', async () => {
  assert.ok(fs.existsSync('src/main/account-settings-ipc.ts'))
  const { registerAccountSettingsIpc } = load('src/main/account-settings-ipc.ts')
  const handlers = {}; const calls = []
  let ok = true
  registerAccountSettingsIpc({ handle: (name, fn) => { handlers[name] = fn } }, async (...args) => { calls.push(args); return { ok, json: async () => ok ? { chatModel: 'gpt-5.5', models: [] } : { error: 'denied' } } })
  assert.equal((await handlers['accountSettings:get']()).success, true)
  await handlers['accountSettings:update']({}, 'gpt-5.5')
  assert.equal(calls[0][0], '/auth/settings')
  assert.equal(calls[1][1].method, 'PATCH')
  assert.equal(calls[1][1].body, JSON.stringify({ chatModel: 'gpt-5.5' }))
  ok = false
  assert.equal((await handlers['accountSettings:update']({}, 'gpt-6-astra')).error, 'denied')
})
