const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const manifest = require('../package.json')
const lock = require('../package-lock.json')
const cwd = path.resolve(__dirname, '..')

test('React and both renderers use the same exact pinned and installed version', () => {
  const expected = manifest.dependencies.react
  assert.match(expected, /^\d+\.\d+\.\d+$/, 'React must be pinned without a range')
  for (const name of ['react', 'react-dom', 'react-test-renderer']) {
    const section = name === 'react-test-renderer' ? 'devDependencies' : 'dependencies'
    assert.equal(manifest[section][name], expected, `${name} manifest pin`)
    assert.equal(lock.packages[''][section][name], expected, `${name} lockfile pin`)
    assert.equal(lock.packages[`node_modules/${name}`].version, expected, `${name} locked version`)
    assert.equal(require(`${name}/package.json`).version, expected, `${name} installed version`)
  }
})

for (const mode of ['development', 'production']) {
  test(`real DOM client renderer loads in ${mode}`, () => {
    const result = spawnSync(process.execPath, ['-e', "const assert = require('node:assert/strict'); assert.equal(typeof require('react-dom/client').createRoot, 'function')"], {
      cwd, env: { ...process.env, NODE_ENV: mode }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  })
}
