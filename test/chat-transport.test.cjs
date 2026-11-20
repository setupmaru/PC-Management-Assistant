const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

const primary = 'https://api.pc-management-assistant.setupmaru.com/api'
const lan = 'http://192.168.0.119:3400/api'
const source = ts.transpileModule(fs.readFileSync('src/main/ipc-handlers.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const response = (status, data) => ({ status, ok: status < 400, json: async () => data })

// Virtual time exercises the production IPC/transport without waiting 75 seconds.
async function harness({ base = primary, chatStatus = 200 } = {}) {
  const handlers = {}, timers = new Map(), calls = [], chunks = []
  let now = 0, nextTimer = 0, chatMode = 'pending', pendingChat
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, exports: module.exports, URL, AbortController,
    console: { log() {}, error() {} },
    process: { env: { API_BASE: base }, resourcesPath: '/unused', cwd: () => '/unused' },
    setInterval: () => ({ unref() {} }),
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id },
    clearTimeout: id => timers.delete(id),
    require(name) {
      if (name === 'electron') return {
        app: { isPackaged: true, getPath: () => '/unused', getAppPath: () => '/unused' },
        ipcMain: { handle: (name, fn) => { handlers[name] = fn } },
        net: { fetch: async (url, options) => {
          calls.push({ url, options })
          if (url.endsWith('/health')) return response(200, { api: 'ok', database: 'ok' })
          if (url.endsWith('/auth/login')) return response(200, { accessToken: 'test-token' })
          if (url.endsWith('/chat/completions')) {
            if (chatMode === 'refused') throw new Error('net::ERR_CONNECTION_REFUSED')
            return new Promise((resolve, reject) => {
              pendingChat = () => resolve(response(chatStatus, chatStatus === 200
                ? { text: 'answer' } : { error: 'AI 응답을 생성하지 못했습니다.' }))
              options.signal.addEventListener('abort', () => reject(new Error('net::ERR_ABORTED')), { once: true })
            })
          }
          throw new Error('Unexpected request: ' + url)
        } },
      }
      if (name === 'fs') return { existsSync: () => false }
      if (name === 'os') return { networkInterfaces: () => ({}) }
      if (name === './account-settings-ipc') return { registerAccountSettingsIpc() {} }
      if (name === './store') return { clearRefreshToken() {} }
      if (name === './claude/prompt-builder') return { buildSystemPrompt: () => 'system' }
      if (name.startsWith('.')) return {}
      return require(name)
    },
  })
  module.exports.registerIpcHandlers(
    { webContents: { send: (channel, chunk) => chunks.push({ channel, ...chunk }) } },
    { getLastSnapshot: () => ({}), getFreshSnapshot: async () => ({}) },
    { streamMessage: async (_payload, _prompt, completion) => completion({ systemPrompt: 'system', messages: [] }) },
  )
  await handlers['auth:login']({}, 'test@example.com', 'password')
  return {
    calls, chunks,
    refuse: () => { chatMode = 'refused' },
    send: async () => {
      const result = handlers['chat:sendMessage']({}, { text: 'hello', attachments: [] })
      await new Promise(resolve => setImmediate(resolve))
      return { result }
    },
    finish: () => pendingChat(),
    advance: async ms => {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now && timers.delete(id)) timer.fn()
      }
      await new Promise(resolve => setImmediate(resolve))
    },
  }
}

for (const base of [primary, lan]) {
  test(`chat at ${base} survives general API limits and the server's 60-second wait`, async () => {
    const h = await harness({ base })
    const { result } = await h.send()
    await h.advance(61_000)
    const requests = h.calls.filter(call => call.url.endsWith('/chat/completions'))
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, `${base}/chat/completions`)
    assert.equal(requests[0].options.signal.aborted, false)
    h.finish()
    assert.equal((await result).success, true)
    assert.equal(h.chunks.length, 0)
  })
}

test('chat timeout remains a timeout in both IPC and UI, without replaying the POST', async () => {
  const h = await harness()
  const { result } = await h.send()
  await h.advance(75_000)
  const outcome = await result
  assert.equal(outcome.success, false)
  assert.match(outcome.error, /AI 응답 대기시간을 초과/)
  assert.equal(h.calls.filter(call => call.url.endsWith('/chat/completions')).length, 1)
  assert.equal(h.chunks.length, 1)
  assert.ok(h.chunks[0].text.includes(outcome.error))
  assert.equal(h.chunks[0].done, true)
})

test('connection refusal shows a Korean connection error and does not replay chat', async () => {
  const h = await harness()
  h.refuse()
  const { result } = await h.send()
  const outcome = await result
  assert.equal(outcome.success, false)
  assert.match(outcome.error, /AI 서버에 연결하지 못했습니다/)
  assert.equal(h.calls.filter(call => call.url.endsWith('/chat/completions')).length, 1)
  assert.ok(h.chunks[0].text.includes(outcome.error))
})

test('server errors are preserved without replaying chat', async () => {
  const h = await harness({ chatStatus: 502 })
  const { result } = await h.send()
  h.finish()
  assert.equal((await result).error, 'AI 응답을 생성하지 못했습니다.')
  assert.equal(h.calls.filter(call => call.url.endsWith('/chat/completions')).length, 1)
})
