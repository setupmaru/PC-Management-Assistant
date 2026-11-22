import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'path'
import dotenv from 'dotenv'
import { DataCollectorService } from './collectors'
import { ClaudeService } from './claude/client'
import { registerIpcHandlers } from './ipc-handlers'
import { clearLegacyApiKey, loadLoginItemConfigured, loadWindowBounds, saveLoginItemConfigured, saveWindowBounds } from './store'
import { AppUpdater } from './updater'

try {
  dotenv.config()
} catch (err) {
  console.error('[dotenv] config failed:', err)
}

const isDev = process.env.FORCE_PROD === '1'
  ? false
  : (process.env.NODE_ENV === 'development' || !app.isPackaged)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let windowReady = false
let shouldShowWindow = false
const BACKGROUND_ARG = '--background'
const collector = new DataCollectorService()
const claude = new ClaudeService()
const updater = new AppUpdater()
let windowControlHandlersRegistered = false

function supportsLoginItems(): boolean {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')
}

function loginItemOptions(): { path?: string; args?: string[] } {
  return process.platform === 'win32'
    ? { path: process.execPath, args: [BACKGROUND_ARG] }
    : {}
}

function setLaunchAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: enabled })
  saveLoginItemConfigured()
}

function isLaunchAtLoginEnabled(): boolean {
  if (!supportsLoginItems()) return false
  try {
    const settings = app.getLoginItemSettings(loginItemOptions())
    return settings.openAtLogin
      && (process.platform !== 'win32' || settings.executableWillLaunchAtLogin)
  } catch (error) {
    console.error('[startup] Failed to read login item:', error)
    return false
  }
}

function shouldStartInBackground(): boolean {
  if (process.argv.includes(BACKGROUND_ARG)) return true
  if (process.platform !== 'darwin') return false
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin
  } catch (error) {
    console.error('[startup] Failed to read launch origin:', error)
    return false
  }
}

function showMainWindow(): void {
  if (isQuitting) return
  shouldShowWindow = true
  if (!windowReady || !mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function updateTrayMenu(): void {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'PC Management Assistant 열기', click: showMainWindow },
    {
      label: '로그인 시 자동 실행',
      type: 'checkbox',
      enabled: supportsLoginItems(),
      checked: isLaunchAtLoginEnabled(),
      click: (item) => {
        try {
          setLaunchAtLogin(item.checked)
        } catch (error) {
          console.error('[startup] Failed to change login item:', error)
          dialog.showErrorBox('자동 실행 설정 실패', '로그인 시 자동 실행 설정을 변경하지 못했습니다.')
        }
        updateTrayMenu()
      },
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]))
}

function createTray(): void {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, iconName)
    : join(app.getAppPath(), 'resources', iconName)
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) throw new Error(`Tray icon not found: ${iconPath}`)
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 })
    icon.setTemplateImage(true)
  }
  tray = new Tray(icon)
  tray.setToolTip('PC Management Assistant')
  tray.on('double-click', showMainWindow)
  if (process.platform !== 'darwin') tray.on('click', showMainWindow)
}

function createWindow(): BrowserWindow {
  const savedBounds = loadWindowBounds()
  const isMac = process.platform === 'darwin'

  const win = new BrowserWindow({
    width: savedBounds?.width ?? 1280,
    height: savedBounds?.height ?? 800,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 900,
    minHeight: 600,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 14, y: 13 } : undefined,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    center: true,
  })
  win.once('ready-to-show', () => {
    windowReady = true
    if (shouldShowWindow) showMainWindow()
  })

  // ?몃? 留곹겕??湲곕낯 釉뚮씪?곗?濡??닿린
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }

  win.on('close', (event) => {
    const bounds = win.getBounds()
    saveWindowBounds(bounds)
    if (!isQuitting && tray && !tray.isDestroyed()) {
      event.preventDefault()
      shouldShowWindow = false
      win.hide()
    }
  })

  // Windows shutdown/logoff must be allowed to close the hidden window.
  win.on('session-end', () => { isQuitting = true })
  win.on('closed', () => {
    mainWindow = null
    windowReady = false
  })

  updater.setWindow(win)
  return win
}

function registerWindowControlHandlers(): void {
  if (windowControlHandlersRegistered) return
  windowControlHandlersRegistered = true

  ipcMain.on('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize()
    }
  })
  ipcMain.on('window:maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close()
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes(BACKGROUND_ARG)) showMainWindow()
  })

  app.on('before-quit', () => { isQuitting = true })
  nativeAutoUpdater.on('before-quit-for-update', () => { isQuitting = true })
  app.on('will-quit', () => {
    collector.destroy()
    tray?.destroy()
    tray = null
  })

  app.whenReady().then(async () => {
    shouldShowWindow = shouldShowWindow || !shouldStartInBackground()
    try {
      createTray()
      updateTrayMenu()
    } catch (error) {
      console.error('[startup] Tray setup failed:', error)
      tray?.destroy()
      tray = null
    }
    if (!tray) shouldShowWindow = true

    // Register only once so later launches respect changes made in OS settings.
    if (tray && supportsLoginItems() && !loadLoginItemConfigured()) {
      try {
        setLaunchAtLogin(true)
        updateTrayMenu()
      } catch (error) {
        console.error('[startup] Failed to register login item:', error)
      }
    }

    registerWindowControlHandlers()
    mainWindow = createWindow()
    updater.initialize(isDev)

    clearLegacyApiKey()
    claude.setWindow(mainWindow)

    // Register IPC before the renderer can send requests.
    registerIpcHandlers(mainWindow, collector, claude)

    app.on('activate', showMainWindow)

    try {
      await collector.initialize(mainWindow)
    } catch (err) {
      console.error('[main] collector initialize failed:', err)
    }
  })
}

app.on('window-all-closed', () => {
  app.quit()
})

function isLocalAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return true
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1'
  } catch {
    return false
  }
}

// 蹂댁븞: 硫붿씤 ?꾩쭅?먮쭔 ?먭꺽 肄섑뀗痢좎뿉????李?李⑤떒
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (contents !== mainWindow?.webContents) return
    if (isLocalAppUrl(url)) return
    event.preventDefault()
    shell.openExternal(url).catch(() => {})
  })
})
