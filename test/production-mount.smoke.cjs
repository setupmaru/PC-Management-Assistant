// Run after npm run build. Install Playwright separately and set NODE_PATH if needed.
// This mounts the actual dist entry in Chromium; only the Electron preload boundary is stubbed.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright')
const dist = path.resolve(__dirname, '../dist')
const artifacts = path.resolve(process.env.SMOKE_ARTIFACTS || '/tmp/pcma-production-smoke')

async function main() {
  await fs.mkdir(artifacts, { recursive: true })
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return }
    const file = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(`${dist}${path.sep}`)) { res.writeHead(403).end(); return }
    try {
      const body = await fs.readFile(file)
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)]
      res.writeHead(200, { 'Content-Type': type || 'application/octet-stream' }).end(body)
    } catch { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  const reports = []
  try {
    browser = await chromium.launch({ headless: true })
    for (const authenticated of [false, true]) {
      const scenario = authenticated ? 'main' : 'login'
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      page.on('requestfailed', request => errors.push(`Request failed: ${request.url()}`))
      await page.addInitScript(({ authenticated }) => {
        const subscribe = () => () => {}
        window.api = {
          platform: 'darwin',
          getLastSnapshot: async () => ({ success: true, data: {} }),
          onMetricsUpdate: subscribe, onProcessesUpdate: subscribe,
          onEventsUpdate: subscribe, onWindowsUpdateUpdate: subscribe,
          auth: {
            refreshToken: async () => authenticated
              ? { success: true, user: { id: 'smoke', email: 'smoke@example.invalid', plan: 'free' } }
              : { success: false },
            getConnectionInfo: async () => ({ reachable: false, apiRunning: false, databaseRunning: false, activeBase: '', triedBases: [] }),
          },
          subscription: { getStatus: async () => ({ success: false }) },
          updater: { getState: async () => ({ enabled: false, status: 'idle' }), onStateChange: subscribe },
        }
      }, { authenticated })
      await page.goto(`http://127.0.0.1:${server.address().port}/`)
      let failure
      try {
        if (authenticated) await page.getByText('DASHBOARD', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
        else {
          await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 10000 })
          await page.locator('input[type="password"]').waitFor({ state: 'visible', timeout: 10000 })
        }
        // Allow post-mount effects/rejections to surface before asserting.
        await page.waitForTimeout(500)
      } catch (error) { failure = error.message }
      const text = await page.locator('#root').innerText()
      const childCount = await page.locator('#root').evaluate(root => root.childElementCount)
      await page.screenshot({ path: path.join(artifacts, `${scenario}.png`) })
      await fs.writeFile(path.join(artifacts, `${scenario}.html`), await page.content())
      reports.push({ scenario, errors, childCount, text, failure })
      await page.close()
    }
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(reports, null, 2))
    console.log(JSON.stringify(reports, null, 2))
    for (const report of reports) {
      assert.equal(report.failure, undefined, `${report.scenario}: ${report.failure}`)
      assert.deepEqual(report.errors, [], `${report.scenario}: runtime errors`)
      assert.ok(report.childCount > 0 && report.text.trim().length > 0, `${report.scenario}: blank root`)
    }
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
