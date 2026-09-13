const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
test('additive model migration is repeatable, preserves users, defaults balanced and checks exact IDs', () => {
  const bin = process.env.PG_TEST_BINDIR
  assert.ok(bin, 'Set PG_TEST_BINDIR to local PostgreSQL binaries; never use a production database')
  const dir = mkdtempSync(path.join(tmpdir(), 'pma-schema-'))
  const run = (cmd, args) => execFileSync(path.join(bin, cmd), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  let started = false
  try {
    run('initdb', ['-D', dir + '/data', '-A', 'trust', '--no-locale'])
    run('pg_ctl', ['-D', dir + '/data', '-l', dir + '/log', '-o', `-k ${dir} -h '' -p 55439`, '-w', 'start']); started = true
    const sql = text => run('psql', ['-h', dir, '-p', '55439', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', text]).trim()
    sql("CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, plan VARCHAR(20) NOT NULL DEFAULT 'free', stripe_customer_id VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()); INSERT INTO users (email,password_hash) VALUES ('existing@example.com','dummy')")
    for (let i = 0; i < 2; i++) run('psql', ['-h', dir, '-p', '55439', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', path.resolve('schema.sql')])
    assert.equal(sql("SELECT chat_model FROM users WHERE email='existing@example.com'"), 'gpt-5.4-mini')
    for (const model of ['gpt-4o-mini', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-6-astra']) sql(`UPDATE users SET chat_model='${model}'`)
    assert.throws(() => sql("UPDATE users SET chat_model='gpt-5.5 '"))
    assert.throws(() => sql('UPDATE users SET chat_model=NULL'))
    assert.equal(sql('SELECT count(*) FROM users'), '1')
  } finally {
    if (started) run('pg_ctl', ['-D', dir + '/data', '-m', 'fast', '-w', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  }
})
