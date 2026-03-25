declare const __EMBEDDED_API_KEY__: string
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import dotenv from 'dotenv'
import { DataCollectorService } from './collectors'
import { ClaudeService } from './claude/client'
import { registerIpcHandlers } from './ipc-handlers'
import { loadApiKey, loadWindowBounds, saveWindowBounds } from './store'
import { warmupSystemInfo } from './collectors/system-metrics'
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
const collector = new DataCollectorService()
const claude = new ClaudeService()
const updater = new AppUpdater()
let windowControlHandlersRegistered = false

// ??以鍮꾨릺??利됱떆 warmup ?쒖옉 (?덈룄???앹꽦怨?蹂묐젹)
app.whenReady().then(() => { warmupSystemInfo().catch(() => {}) })

function createWindow(): BrowserWindow {
  const savedBounds = loadWindowBounds()

  const win = new BrowserWindow({
    width: savedBounds?.width ?? 1280,
    height: savedBounds?.height ?? 800,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 900,
    minHeight: 600,
    frame: false, // 而ㅼ뒪? ??댄?諛?    backgroundColor: '#0f172a',
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
    win.show()
    win.focus()
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

  win.on('close', () => {
    const bounds = win.getBounds()
    saveWindowBounds(bounds)
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

app.whenReady().then(async () => {
  registerWindowControlHandlers()
  mainWindow = createWindow()
  updater.initialize(isDev)

  // API ??濡쒕뱶 ??Claude 珥덇린??(??λ맂 ???놁쑝硫?鍮뚮뱶?????ъ슜)
  const apiKey = loadApiKey() || __EMBEDDED_API_KEY__ || null
  if (apiKey) {
    claude.updateApiKey(apiKey)
  }
  claude.setWindow(mainWindow)

  // IPC ?몃뱾?щ? 癒쇱? ?깅줉 (renderer媛 ready-to-show ?꾩뿉 ?몄텧?????덉쓬)
  registerIpcHandlers(mainWindow, collector, claude)

  // ?곗씠???섏쭛 ?쒖옉
  try {
    await collector.initialize(mainWindow)
  } catch (err) {
    console.error('[main] collector initialize failed:', err)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  collector.destroy()
  if (process.platform !== 'darwin') app.quit()
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

