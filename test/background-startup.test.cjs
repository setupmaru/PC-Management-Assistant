const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const mainCode = ts.transpileModule(fs.readFileSync('src/main/main.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText

// Exercise the actual main-process entry against an in-memory Electron boundary.
// No test writes login items to the host OS or starts system repair collectors.
async function launch(options = {}) {
  const state = {
    windows: [], trays: [], registrations: [], loginQueries: [], iconPaths: [], errors: [],
    configured: options.configured ?? false,
    initialized: 0, destroyed: 0, warmedUp: 0, quitCalls: 0, savedBounds: 0, dialogs: 0,
    settings: {
      openAtLogin: false, executableWillLaunchAtLogin: false, wasOpenedAtLogin: false,
      ...options.settings,
    },
  }
  const app = new EventEmitter()
  const updater = new EventEmitter()
  const ipcMain = new EventEmitter()
  let resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })
  Object.assign(app, {
    isPackaged: options.packaged ?? true,
    requestSingleInstanceLock: () => options.lock !== false,
    whenReady: () => ready,
    getAppPath: () => process.cwd(),
    getLoginItemSettings: query => {
      state.loginQueries.push(query)
      return { ...state.settings }
    },
    setLoginItemSettings: settings => {
      if (options.registrationFails) throw new Error('registration failed')
      state.registrations.push(settings)
      state.settings.openAtLogin = settings.openAtLogin
      state.settings.executableWillLaunchAtLogin = settings.openAtLogin
    },
    quit: () => {
      state.quitCalls++
      app.quitting = true
      app.emit('before-quit')
      for (const window of state.windows) if (!window.destroyed) window.close()
      if (state.windows.every(window => window.destroyed)) app.emit('will-quit')
    },
  })
  class Window extends EventEmitter {
    constructor(config) {
      super()
      this.config = config
      this.destroyed = false
      this.visible = false
      this.minimized = false
      this.shows = 0
      this.restores = 0
      this.focuses = 0
      this.webContents = { setWindowOpenHandler() {}, openDevTools() {} }
      state.windows.push(this)
    }
    loadURL() {}
    loadFile() {}
    isDestroyed() { return this.destroyed }
    isMinimized() { return this.minimized }
    minimize() { this.minimized = true }
    restore() { this.minimized = false; this.restores++ }
    show() { this.visible = true; this.shows++ }
    focus() { this.focuses++ }
    hide() { this.visible = false }
    getBounds() { return { x: 0, y: 0, width: 1280, height: 800 } }
    close() {
      let prevented = false
      this.emit('close', { preventDefault() { prevented = true } })
      if (prevented) return
      this.destroyed = true
      this.visible = false
      this.emit('closed')
      if (!app.quitting) app.emit('window-all-closed')
    }
  }
  class Tray extends EventEmitter {
    constructor() { super(); state.trays.push(this); this.destroyed = false }
    setToolTip() {}
    setContextMenu(menu) { this.menu = menu }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true }
  }
  const electron = {
    app, autoUpdater: updater, BrowserWindow: Window, ipcMain, Tray,
    dialog: { showErrorBox() { state.dialogs++ } },
    Menu: { buildFromTemplate: items => ({ items }) },
    nativeImage: {
      createFromPath(file) {
        state.iconPaths.push(file)
        return {
          isEmpty: () => options.missingIcon ?? false,
          resize() { return this }, setTemplateImage() {},
        }
      },
    },
  }
  const modules = {
    electron,
    path,
    dotenv: { config() {} },
    './collectors': { DataCollectorService: class {
      async initialize() { state.initialized++ }
      destroy() { state.destroyed++ }
    } },
    './claude/client': { ClaudeService: class { setWindow() {} } },
    './ipc-handlers': { registerIpcHandlers() {} },
    './collectors/system-metrics': { warmupSystemInfo: async () => { state.warmedUp++ } },
    './updater': { AppUpdater: class { initialize() {}; setWindow() {} } },
    './store': {
      loadLoginItemConfigured: () => state.configured,
      saveLoginItemConfigured: () => { state.configured = true },
      loadWindowBounds() {},
      saveWindowBounds() { state.savedBounds++ },
      clearLegacyApiKey() {},
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(mainCode, {
    module, exports: module.exports,
    __dirname: '/app/dist-electron',
    require: name => {
      assert.ok(name in modules, `Unexpected main-process dependency: ${name}`)
      return modules[name]
    },
    process: {
      platform: options.platform ?? 'win32',
      argv: ['pc-assistant', ...(options.args ?? [])],
      execPath: '/installed/PC Management Assistant.exe',
      resourcesPath: '/installed/resources',
      env: {},
    },
    console: { error: (...args) => state.errors.push(args) },
  })
  if (options.beforeReady) options.beforeReady(app)
  resolveReady()
  await new Promise(resolve => setImmediate(resolve))
  return { ...state, state, app, updater, ipcMain }
}

function menuItem(run, label) {
  return run.trays[0].menu.items.find(item => item.label === label)
}

test('first packaged launch registers background login startup and shows manual launch', async () => {
  const run = await launch()
  const [window] = run.windows
  assert.equal(run.registrations.length, 1)
  assert.equal(JSON.stringify(run.registrations[0]), JSON.stringify({
    path: '/installed/PC Management Assistant.exe', args: ['--background'], openAtLogin: true,
  }))
  assert.equal(run.state.configured, true)
  assert.equal(window.visible, false)
  window.emit('ready-to-show')
  assert.equal(window.visible, true)
  assert.equal(menuItem(run, '로그인 시 자동 실행').checked, true)
  assert.equal(run.iconPaths[0], '/installed/resources/icon.ico')
})

test('login startup stays hidden, keeps collecting after close, and reopens from tray', async () => {
  const run = await launch({ args: ['--background'] })
  const [window] = run.windows
  window.emit('ready-to-show')
  assert.equal(window.shows, 0)
  assert.equal(run.state.initialized, 1)
  menuItem(run, 'PC Management Assistant 열기').click()
  assert.equal(window.visible, true)
  run.ipcMain.emit('window:close')
  assert.equal(window.visible, false)
  assert.equal(window.destroyed, false)
  assert.equal(run.state.destroyed, 0)
  assert.equal(run.state.savedBounds, 1)
  window.minimize()
  run.trays[0].emit('click')
  assert.equal(window.visible, true)
  assert.equal(window.restores, 1)
  assert.equal(run.windows.length, 1)
  menuItem(run, '종료').click()
  assert.equal(window.destroyed, true)
  assert.equal(run.state.destroyed, 1)
  assert.equal(run.trays[0].destroyed, true)
})

test('a second manual launch opens the existing window, a background launch does not', async () => {
  const run = await launch({ args: ['--background'] })
  const [window] = run.windows
  window.emit('ready-to-show')
  run.app.emit('second-instance', {}, ['pc-assistant', '--background'])
  assert.equal(window.visible, false)
  run.app.emit('second-instance', {}, ['pc-assistant'])
  assert.equal(window.visible, true)
  assert.equal(run.windows.length, 1)
  assert.equal(run.state.initialized, 1)
})

test('a manual launch arriving before app/window readiness is not lost', async () => {
  const run = await launch({
    args: ['--background'],
    beforeReady: app => app.emit('second-instance', {}, ['pc-assistant']),
  })
  assert.equal(run.windows[0].visible, false)
  run.windows[0].emit('ready-to-show')
  assert.equal(run.windows[0].visible, true)
})

test('macOS login origin starts hidden and dock activation reopens the same window', async () => {
  const run = await launch({ platform: 'darwin', settings: { wasOpenedAtLogin: true } })
  const [window] = run.windows
  window.emit('ready-to-show')
  assert.equal(window.visible, false)
  assert.equal(JSON.stringify(run.registrations[0]), JSON.stringify({ openAtLogin: true }))
  assert.equal(run.iconPaths[0], '/installed/resources/icon.png')
  run.app.emit('activate')
  assert.equal(window.visible, true)
  window.close()
  assert.equal(window.destroyed, false)
  run.app.emit('activate')
  assert.equal(window.visible, true)
  assert.equal(run.state.initialized, 1)
})

test('later launches preserve OS opt-out and the tray toggle can enable and disable startup', async () => {
  const run = await launch({
    configured: true,
    settings: { openAtLogin: true, executableWillLaunchAtLogin: false },
  })
  assert.equal(run.registrations.length, 0)
  assert.equal(menuItem(run, '로그인 시 자동 실행').checked, false)
  menuItem(run, '로그인 시 자동 실행').click({ checked: true })
  assert.equal(menuItem(run, '로그인 시 자동 실행').checked, true)
  menuItem(run, '로그인 시 자동 실행').click({ checked: false })
  assert.equal(menuItem(run, '로그인 시 자동 실행').checked, false)
  assert.equal(run.registrations.length, 2)
  assert.equal(run.registrations[1].openAtLogin, false)
  assert.equal(JSON.stringify(run.registrations[0].args), JSON.stringify(run.registrations[1].args))
  const restarted = await launch({ configured: run.state.configured, settings: run.state.settings })
  assert.equal(restarted.registrations.length, 0)
  assert.equal(menuItem(restarted, '로그인 시 자동 실행').checked, false)
})

test('development runs do not register the Electron binary as a login item', async () => {
  const run = await launch({ packaged: false })
  assert.equal(run.registrations.length, 0)
  assert.equal(run.state.configured, false)
  assert.equal(menuItem(run, '로그인 시 자동 실행').enabled, false)
  assert.equal(run.iconPaths[0], path.join(process.cwd(), 'resources/icon.ico'))
})

test('losing the single-instance lock exits before creating windows, tray or collectors', async () => {
  const run = await launch({ lock: false })
  assert.equal(run.windows.length, 0)
  assert.equal(run.trays.length, 0)
  assert.equal(run.state.initialized, 0)
  assert.equal(run.state.warmedUp, 0)
  assert.equal(run.registrations.length, 0)
  assert.equal(run.state.quitCalls, 1)
})

test('missing tray resources fall back to a visible, closable app', async () => {
  const run = await launch({ args: ['--background'], missingIcon: true })
  const [window] = run.windows
  window.emit('ready-to-show')
  assert.equal(window.visible, true)
  assert.equal(run.trays.length, 0)
  assert.equal(run.registrations.length, 0)
  window.close()
  assert.equal(window.destroyed, true)
  assert.equal(run.state.destroyed, 1)
})

test('registration failure keeps the app usable and allows a later registration retry', async () => {
  const run = await launch({ registrationFails: true })
  run.windows[0].emit('ready-to-show')
  assert.equal(run.windows[0].visible, true)
  assert.equal(run.state.configured, false)
  assert.equal(menuItem(run, '로그인 시 자동 실행').checked, false)
  menuItem(run, '로그인 시 자동 실행').click({ checked: true })
  assert.equal(run.state.dialogs, 1)
  assert.equal(menuItem(run, '로그인 시 자동 실행').checked, false)
})

for (const reason of ['update', 'shutdown']) {
  test(`${reason} can close the background window without hide-to-tray blocking exit`, async () => {
    const run = await launch({ args: ['--background'] })
    if (reason === 'update') run.updater.emit('before-quit-for-update')
    else run.windows[0].emit('session-end')
    run.windows[0].close()
    assert.equal(run.windows[0].destroyed, true)
    assert.equal(run.state.destroyed, 1)
    assert.equal(run.trays[0].destroyed, true)
  })
}
