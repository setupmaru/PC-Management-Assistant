const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
const response = (status, data = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => data })
const credentials = account => ({ accessToken: `access-${account}`, refreshToken: `refresh-${account}`, user: { id: account } })
function harness() {
  const handlers = {}
  const calls = []
  let refreshToken = null
  let intercept = () => undefined
  function load(file) {
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    vm.runInNewContext(code, {
      module, exports: module.exports, console, URL, AbortController, setTimeout, clearTimeout,
      setInterval: () => ({ unref() {} }), process: { ...process, resourcesPath: '/unused' },
      require(name) {
        if (name === 'electron') return {
          ipcMain: { handle: (name, fn) => { handlers[name] = fn } },
          app: { getPath: () => '/unused', getAppPath: () => '/unused', isPackaged: false },
          net: { fetch: async (url, options) => {
            const call = { path: new URL(url).pathname.replace(/^\/api/, ''), ...options }
            calls.push(call)
            const result = intercept(call)
            if (result !== undefined) return result
            if (call.path === '/health') return response(200, { api: 'ok', database: 'ok' })
            if (call.path === '/auth/login') return response(200, credentials(JSON.parse(call.body).email))
            if (call.path === '/auth/refresh') return response(200, { accessToken: 'refreshed' })
            return response(200)
          } },
        }
        if (name === './store') return {
          loadRefreshToken: () => refreshToken,
          saveRefreshToken: value => { refreshToken = value },
          clearRefreshToken: () => { refreshToken = null },
        }
        if (name === './account-settings-ipc') return load('src/main/account-settings-ipc.ts')
        if (name === 'fs') return { existsSync: () => false }
        if (name === 'os') return { networkInterfaces: () => ({}) }
        if (name.startsWith('.')) return {}
        return require(name)
      },
    })
    return module.exports
  }
  load('src/main/ipc-handlers.ts').registerIpcHandlers({}, { getLastSnapshot: () => ({}) }, {})
  return {
    calls, intercept: fn => { intercept = fn }, token: () => refreshToken,
    invoke: (name, ...args) => handlers[name]({}, ...args),
    login: account => handlers['auth:login']({}, account, 'password'),
  }
}

test('same-session 401 still refreshes and retries the original PATCH once', async () => {
  const h = harness()
  await h.login('A')
  let attempts = 0
  h.intercept(call => call.method === 'PATCH' ? response(++attempts === 1 ? 401 : 200) : undefined)
  assert.equal((await h.invoke('accountSettings:update', 'gpt-5.5')).success, true)
  const patches = h.calls.filter(c => c.method === 'PATCH')
  assert.equal(patches.length, 2)
  assert.equal(patches[0].headers.Authorization, 'Bearer access-A')
  assert.equal(patches[1].headers.Authorization, 'Bearer refreshed')
  assert.equal(patches[1].body, patches[0].body)
  assert.equal(h.calls.filter(c => c.path === '/auth/refresh').length, 1)
  assert.equal(h.token(), 'refresh-A')
})

test('successful retry arriving after logout is rejected', async () => {
  const h = harness()
  await h.login('A')
  const retryStarted = deferred()
  const pending = deferred()
  let attempts = 0
  h.intercept(call => {
    if (call.method !== 'PATCH') return undefined
    if (++attempts === 1) return response(401)
    retryStarted.resolve()
    return pending.promise
  })
  const patch = h.invoke('accountSettings:update', 'gpt-5.5')
  await retryStarted.promise
  await h.invoke('auth:logout')
  pending.resolve(response(200))
  assert.equal((await patch).success, false)
})

for (const failureChannel of ['accountSettings:update', 'auth:refreshToken']) {
  test(`${failureChannel} expiration invalidates other pending refresh callbacks`, async () => {
    const h = harness()
    await h.login('A')
    const pending = deferred()
    let refreshes = 0
    h.intercept(call => {
      if (call.method === 'PATCH') return response(401)
      if (call.path === '/auth/refresh') return ++refreshes === 1 ? pending.promise : response(401)
    })
    const stale = h.invoke('auth:refreshToken')
    assert.equal((await h.invoke(failureChannel, 'gpt-5.5')).success, false)
    pending.resolve(response(200, credentials('A')))
    assert.equal((await stale).success, false)
    assert.equal((await h.invoke('accountSettings:get')).success, false)
  })
}

for (const [channel, route] of [
  ['auth:login', '/auth/login'], ['auth:register', '/auth/register'],
  ['auth:verifyEmail', '/auth/verify-email'], ['auth:refreshToken', '/auth/refresh'],
]) {
  for (const switchToB of [false, true]) {
    test(`${channel} late body cannot restore A after ${switchToB ? 'B login' : 'logout'}`, async () => {
      const h = harness()
      await h.login('A')
      const pending = deferred()
      h.intercept(call => call.path === route ? { ...response(200), json: () => pending.promise } : undefined)
      const stale = h.invoke(channel, 'A', 'code-or-password')
      // Let the callback enter its asynchronous response-body read.
      await new Promise(resolve => setImmediate(resolve))
      h.intercept(() => undefined)
      if (switchToB) await h.login('B')
      else await h.invoke('auth:logout')
      pending.resolve(credentials('A'))
      assert.equal((await stale).success, false)
      assert.equal(h.token(), switchToB ? 'refresh-B' : null)
      const current = await h.invoke('accountSettings:get')
      assert.equal(current.success, switchToB)
      if (switchToB) assert.equal(h.calls.at(-1).headers.Authorization, 'Bearer access-B')
    })
  }
}

test('logout clears locally before network completion and cannot clear a later login', async () => {
  const h = harness()
  await h.login('A')
  const pending = deferred()
  h.intercept(call => call.path === '/auth/logout' ? pending.promise : undefined)
  const logout = h.invoke('auth:logout')
  assert.equal(h.token(), null)
  assert.equal((await h.invoke('accountSettings:get')).success, false)
  await h.login('B')
  pending.resolve(response(200))
  await logout
  assert.equal(h.token(), 'refresh-B')
  await h.invoke('accountSettings:get')
  assert.equal(h.calls.at(-1).headers.Authorization, 'Bearer access-B')
})

test('direct B login invalidates pending A request without requiring logout', async () => {
  const h = harness()
  await h.login('A')
  const pending = deferred()
  h.intercept(call => call.method === 'PATCH' ? pending.promise : undefined)
  const patch = h.invoke('accountSettings:update', 'gpt-5.5')
  await h.login('B')
  pending.resolve(response(401))
  await patch
  assert.equal(h.calls.filter(c => c.path === '/auth/refresh').length, 0)
})

for (const stage of ['response', 'body', 'failure']) {
  test(`pending automatic refresh ${stage} cannot overwrite B or replay A PATCH`, async () => {
    const h = harness()
    await h.login('A')
    const started = deferred()
    const pending = deferred()
    h.intercept(call => {
      if (call.method === 'PATCH') return response(401)
      if (call.path === '/auth/refresh') {
        started.resolve()
        return stage === 'body' ? { ...response(200), json: () => pending.promise } : pending.promise
      }
    })
    const patch = h.invoke('accountSettings:update', 'gpt-5.5')
    await started.promise
    await h.invoke('auth:logout')
    await h.login('B')
    pending.resolve(stage === 'body' ? { accessToken: 'stale-A' } : response(stage === 'failure' ? 401 : 200, { accessToken: 'stale-A' }))
    assert.equal((await patch).success, false)
    assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 1)
    assert.equal(h.token(), 'refresh-B')
    await h.invoke('accountSettings:get')
    assert.equal(h.calls.at(-1).headers.Authorization, 'Bearer access-B')
  })
}

test('late A PATCH 401 cannot refresh or replay as B after logout/login', async () => {
  const h = harness()
  await h.login('A')
  const pending = deferred()
  h.intercept(call => call.method === 'PATCH' ? pending.promise : undefined)
  const patch = h.invoke('accountSettings:update', 'gpt-5.5')
  await h.invoke('auth:logout')
  await h.login('B')
  pending.resolve(response(401))
  assert.equal((await patch).success, false)
  assert.equal(h.calls.filter(c => c.path === '/auth/refresh').length, 0)
  assert.equal(h.calls.filter(c => c.method === 'PATCH').length, 1)
  assert.equal(h.token(), 'refresh-B')
})
