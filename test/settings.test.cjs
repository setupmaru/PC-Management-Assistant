const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file)
const React = require('react')
const { create, act } = require('react-test-renderer')
global.IS_REACT_ACT_ENVIRONMENT = true
const sub = require.resolve('../src/renderer/components/Settings/SubscriptionSection.tsx')
require.cache[sub] = { id: sub, filename: sub, loaded: true, exports: { __esModule: true, default: () => null } }
const Settings = require('../src/renderer/components/Settings/SettingsModal.tsx').default
const data = { chatModel: 'gpt-5.4-mini', models: [{ id: 'gpt-4o-mini', label: 'economy' }, { id: 'gpt-5.4-mini', label: 'balanced' }] }
test('selector loads server options, saves, reports errors, and ignores old-account responses', async () => {
  const gets = [], saves = []
  global.window = { api: { accountSettings: {
    get: () => new Promise(resolve => gets.push(resolve)),
    update: model => new Promise(resolve => saves.push({ model, resolve })),
  } } }
  let root
  const props = { onClose() {}, onLogout() {}, accountId: 'a' }
  await act(async () => { root = create(React.createElement(Settings, props)) })
  assert.equal(gets.length, 1)
  await act(async () => gets[0]({ success: true, data }))
  assert.equal(root.root.findByType('select').props.value, data.chatModel)
  await act(async () => root.root.findByType('select').props.onChange({ target: { value: 'gpt-4o-mini' } }))
  const save = () => root.root.findAllByType('button').find(b => b.props.children === '모델 저장')
  await act(async () => { save().props.onClick() })
  assert.equal(saves[0].model, 'gpt-4o-mini')
  await act(async () => saves[0].resolve({ success: false, error: 'save failed' }))
  assert.match(JSON.stringify(root.toJSON()), /save failed/)
  await act(async () => { save().props.onClick() })
  await act(async () => root.update(React.createElement(Settings, { ...props, accountId: 'b' })))
  assert.equal(gets.length, 2)
  await act(async () => gets[1]({ success: true, data }))
  await act(async () => saves[1].resolve({ success: true, data: { ...data, chatModel: 'gpt-4o-mini' } }))
  assert.equal(root.root.findByType('select').props.value, 'gpt-5.4-mini')
  await act(async () => root.unmount())
  await act(async () => { root = create(React.createElement(Settings, props)) })
  assert.equal(gets.length, 3)
  await act(async () => gets[2]({ success: false, error: 'offline' }))
  assert.match(JSON.stringify(root.toJSON()), /offline/)
  await act(async () => root.unmount())
})
