const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

const primary = 'https://api.pc-management-assistant.setupmaru.com/api'
const lan = 'http://192.168.0.119:3400/api'
const bundled = JSON.parse(fs.readFileSync('pc-assistant.config.json', 'utf8'))
const retired = ['https://donas811.synology.me:3443/api', 'https://pma-api.setupmaru.com/api']
const source = ts.transpileModule(fs.readFileSync('src/main/ipc-handlers.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

function harness({ packaged = true, files = { '/installed/pc-assistant.config.json': bundled }, env = {}, unavailable = [] } = {}) {
  const handlers = {}
  const calls = []
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, exports: module.exports, URL, AbortController, setTimeout, clearTimeout,
    console: { log() {}, error() {} },
    process: { env, resourcesPath: '/installed/resources', cwd: () => '/work' },
    setInterval: () => ({ unref() {} }),
    require(name) {
      if (name === 'electron') return {
        app: {
          isPackaged: packaged,
          getPath: name => name === 'userData' ? '/user-data' : '/installed/PC Management Assistant.exe',
          getAppPath: () => '/installed/resources/app',
        },
        ipcMain: { handle: (name, fn) => { handlers[name] = fn } },
        net: { fetch: async url => {
          calls.push(url)
          if (unavailable.some(base => url.startsWith(`${base}/`))) throw new Error('net::ERR_NAME_NOT_RESOLVED')
          return { status: 200, json: async () => ({ api: { reachable: true }, db: { reachable: true } }) }
        } },
      }
      if (name === 'fs') return {
        existsSync: file => Object.hasOwn(files, file),
        readFileSync: file => JSON.stringify(files[file]),
      }
      if (name === 'os') return { networkInterfaces: () => ({ wifi: [{ address: '192.168.0.157', family: 'IPv4', internal: false }] }) }
      if (name === './account-settings-ipc') return { registerAccountSettingsIpc() {} }
      if (name.startsWith('.')) return {}
      return require(name)
    },
  })
  module.exports.registerIpcHandlers({}, {}, {})
  return { calls, info: () => handlers['auth:getConnectionInfo']() }
}

test('packaged app first requests the new HTTPS domain before LAN and localhost', async () => {
  const h = harness()
  const info = await h.info()
  assert.equal(info.reachable, true)
  assert.equal(info.activeBase, primary)
  assert.equal(info.triedBases[0], primary)
  assert.equal(h.calls[0], `${primary}/health`)
  assert.ok(info.triedBases.includes(lan))
  assert.ok(info.triedBases.includes('http://localhost:3400/api'))
})

test('packaged app without an external config still defaults to the new HTTPS domain', async () => {
  const info = await harness({ files: {} }).info()
  assert.equal(info.triedBases[0], primary)
  assert.equal(info.activeBase, primary)
})

for (const localOverrides of [[], ['http://192.168.0.117:3400/api', 'http://localhost:3400/api']]) {
  test(`upgrade ignores retired domains in userData config with ${localOverrides.length} local overrides`, async () => {
    const files = {
      '/user-data/pc-assistant.config.json': { API_BASES: [...retired, ...localOverrides] },
      '/installed/pc-assistant.config.json': bundled,
    }
    const info = await harness({ files }).info()
    assert.equal(info.activeBase, primary)
    assert.equal(info.triedBases[0], primary)
    for (const old of retired) assert.equal(info.triedBases.includes(old), false)
  })
}

test('new domain DNS failure falls back to the reachable LAN API with DB health intact', async () => {
  const h = harness({ unavailable: [primary] })
  const info = await h.info()
  assert.equal(h.calls[0], `${primary}/health`)
  assert.equal(info.activeBase, lan)
  assert.equal(info.reachable, true)
  assert.equal(info.apiRunning, true)
  assert.equal(info.databaseRunning, true)
  assert.equal(info.error, undefined)
  for (const old of retired) assert.equal(info.triedBases.includes(old), false)
})

test('later requests reuse the reachable LAN API instead of repeating the failed DNS lookup', async () => {
  const h = harness({ unavailable: [primary] })
  const first = await h.info()
  assert.equal(first.activeBase, lan)
  const previousCalls = h.calls.length
  const next = await h.info()
  assert.equal(next.triedBases[0], lan)
  assert.equal(next.activeBase, lan)
  assert.deepEqual(h.calls.slice(previousCalls), [`${lan}/health`])
  const restarted = harness()
  assert.equal((await restarted.info()).activeBase, primary)
  assert.equal(restarted.calls[0], `${primary}/health`)
})

test('development keeps local API access first', async () => {
  const info = await harness({ packaged: false }).info()
  assert.equal(info.triedBases[0], lan)
  assert.equal(info.activeBase, lan)
})

test('explicit custom environment and userData domains remain supported', async () => {
  const custom = 'https://custom.example.invalid/api'
  const viaEnv = await harness({ env: { API_BASES: [...retired, custom].join(',') } }).info()
  assert.equal(viaEnv.activeBase, custom)
  for (const old of retired) assert.equal(viaEnv.triedBases.includes(old), false)
  const viaFile = await harness({ files: { '/user-data/pc-assistant.config.json': { API_BASE: custom } } }).info()
  assert.equal(viaFile.activeBase, custom)
})
