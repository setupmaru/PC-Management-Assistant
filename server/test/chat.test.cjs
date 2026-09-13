const assert = require('node:assert/strict')
const { test, before, after, beforeEach } = require('node:test')
const { once } = require('node:events')
require('ts-node/register')
function stub(path, exports) {
  const id = require.resolve(path)
  require.cache[id] = { id, filename: id, loaded: true, exports }
}
const env = { OPENAI_API_KEY: 'sk-test-only-not-real-123456789', OPENAI_MODEL: 'gpt-6-astra', JWT_ACCESS_SECRET: 'test-secret', JWT_REFRESH_SECRET: 'test-refresh' }
stub('../src/config/env.ts', env)
let accounts, plan, allowance, quotaCalls, upstream
stub('../src/config/db.ts', { __esModule: true, default: { query: async (sql, values) => {
  const row = accounts.get(values[0])
  if (sql.startsWith('UPDATE') && row) {
    if (values[1] === 'gpt-6-astra' && row.email !== 'setupmaru@setupmaru.com') return { rows: [] }
    row.chat_model = values[1]
  }
  return { rows: row ? [{ ...row }] : [] }
} } })
stub('../src/services/email.service.ts', {})
stub('../src/services/subscription.service.ts', {
  getSubscriptionStatus: async () => ({ plan }),
  checkAndUseChatLimit: async () => { quotaCalls++; return allowance },
})
const express = require('express')
const jwt = require('jsonwebtoken')
const realFetch = global.fetch
let server, base
before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/auth', require('../src/routes/auth.ts').default)
  app.use('/chat', require('../src/routes/chat.ts').default)
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}`
  global.fetch = async (target, options) => {
    assert.equal(target, 'https://api.openai.com/v1/chat/completions')
    upstream.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: ' answer ' } }] }))
  }
})
after(async () => { global.fetch = realFetch; if(server) await new Promise(resolve => server.close(resolve)) })
beforeEach(() => {
  accounts = new Map([['a', { email: 'other@example.com', chat_model: 'gpt-5.4-mini' }], ['b', { email: 'setupmaru@setupmaru.com', chat_model: 'gpt-5.4-mini' }]])
  plan = 'pro'; allowance = { allowed: true, remaining: 7 }; quotaCalls = 0; upstream = []
})
async function request(path, method = 'GET', body, id = 'a', email = 'setupmaru@setupmaru.com', tokenOverride) {
  const token = tokenOverride ?? jwt.sign({ id, email, plan: 'pro' }, env.JWT_ACCESS_SECRET)
  const res = await realFetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, body: data }
}
test('PATCH persists only the authenticated account across sessions and validates exact authorization', async () => {
  for (const model of ['gpt-4o-mini', 'gpt-5.4-mini', 'gpt-5.5']) {
    assert.equal((await request('/auth/settings', 'PATCH', { chatModel: model, id: 'b', email: 'setupmaru@setupmaru.com' })).status, 200)
    assert.equal((await request('/auth/settings', 'GET', undefined, 'a', 'new-session@example.com')).body.chatModel, model)
    assert.equal(accounts.get('b').chat_model, 'gpt-5.4-mini')
  }
  for (const email of ['other@example.com', 'setupmaru@setupmaru', 'Setupmaru@setupmaru.com', ' setupmaru@setupmaru.com', 'setupmaru@setupmaru.com ', 'setupmaru@setupmaru.com.evil']) {
    accounts.get('a').email = email
    assert.equal((await request('/auth/settings', 'PATCH', { chatModel: 'gpt-6-astra' })).status, 403)
  }
  assert.equal((await request('/auth/settings', 'PATCH', { chatModel: 'gpt-6-astra' }, 'b')).status, 200)
  for (const model of [null, 1, {}, 'GPT-5.5', 'gpt-5.5 ', 'gpt-6-astra-2026', 'unknown']) {
    assert.equal((await request('/auth/settings', 'PATCH', { chatModel: model })).status, 400)
  }
  assert.equal((await request('/auth/settings', 'GET', undefined, 'missing')).status, 401)
  assert.equal((await request('/auth/settings', 'PATCH', { chatModel: 'gpt-5.5' }, 'missing')).status, 401)
  assert.equal((await request('/auth/settings', 'GET', undefined, 'a', '', 'invalid')).status, 401)
})

const chat = (id = 'a', extra = {}) => request('/chat/completions', 'POST', { systemPrompt: 'PC assistant', messages: [{ role: 'user', content: 'Help' }], ...extra }, id)

test('chat reads persisted selection each request, ignoring all client and global overrides', async () => {
  for (const model of ['gpt-4o-mini', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-6-astra']) {
    const id = model === 'gpt-6-astra' ? 'b' : 'a'
    await request('/auth/settings', 'PATCH', { chatModel: model }, id)
    assert.equal((await chat(id, { model: 'gpt-6-astra', email: 'setupmaru@setupmaru.com', user: { id: 'b' } })).status, 200)
    const body = upstream.at(-1)
    assert.equal(body.model, model)
    assert.equal(body[model === 'gpt-4o-mini' ? 'max_tokens' : 'max_completion_tokens'], 2048)
    assert.equal(model === 'gpt-4o-mini' ? 'max_completion_tokens' in body : 'max_tokens' in body, false)
  }
  accounts.get('a').chat_model = 'gpt-6-astra'
  await chat('a')
  assert.equal(upstream.at(-1).model, 'gpt-5.4-mini')
  accounts.get('b').email = 'setupmaru@setupmaru'
  await chat('b')
  assert.equal(upstream.at(-1).model, 'gpt-5.4-mini')
  plan = 'plus'
  assert.equal((await chat('missing')).status, 401)
  assert.equal(quotaCalls, 0)
})

test('subscription and request safeguards remain intact', async () => {
  plan = 'free'; assert.equal((await chat('b')).status, 403)
  assert.equal(quotaCalls, 0); assert.equal(upstream.length, 0)
  plan = 'plus'; assert.deepEqual(await chat('b'), { status: 200, body: { text: 'answer', remaining: 7 } })
  assert.equal(quotaCalls, 1)
  allowance.allowed = false; assert.equal((await chat('b')).status, 429)
  assert.equal(upstream.length, 1)
  assert.equal((await chat('b', { messages: [] })).status, 400)
  assert.equal((await request('/chat/completions', 'POST', {}, 'b', '', 'bad')).status, 401)
})

test('settings use database identity; every account including administrator defaults balanced', async () => {
  for (const id of ['a', 'b']) {
    const result = await request('/auth/settings', 'GET', undefined, id)
    assert.equal(result.status, 200)
    assert.equal(result.body.chatModel, 'gpt-5.4-mini')
    assert.deepEqual(result.body.models.map(m => m.id), id === 'b' ? ['gpt-4o-mini', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-6-astra'] : ['gpt-4o-mini', 'gpt-5.4-mini', 'gpt-5.5'])
  }
})
