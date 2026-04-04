import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { AppUpdateState } from '../shared/updater'

const UPDATE_STATE_CHANNEL = 'app:updateState'
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

function createInitialState(): AppUpdateState {
  return {
    enabled: false,
    status: 'disabled',
    currentVersion: app.getVersion(),
    availableVersion: null,
    progressPercent: null,
    transferredBytes: 0,
    totalBytes: 0,
    error: null,
    checkedAt: null,
  }
}

export class AppUpdater {
  private window: BrowserWindow | null = null
  private initialized = false
  private downloadPromise: Promise<string[]> | null = null
  private installScheduled = false
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private state: AppUpdateState = createInitialState()

  setWindow(window: BrowserWindow | null): void {
    this.window = window
    this.emitState()
  }

  initialize(isDev: boolean): void {
    if (this.initialized) return
    this.initialized = true

    ipcMain.handle('updater:getState', async () => this.getState())
    ipcMain.handle('updater:apply', async () => this.applyUpdate())
    ipcMain.handle('updater:check', async () => this.checkForUpdates())

    if (isDev || !app.isPackaged) {
      this.setState({
        enabled: false,
        status: 'disabled',
        error: 'Auto update is disabled in development mode.',
      })
      return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => {
      this.setState({
        enabled: true,
        status: 'checking',
        error: null,
        progressPercent: null,
        transferredBytes: 0,
        totalBytes: 0,
      })
    })

    autoUpdater.on('update-available', (info) => {
      this.installScheduled = false
      this.setState({
        enabled: true,
        status: 'available',
        availableVersion: info.version ?? null,
        error: null,
        checkedAt: Date.now(),
        progressPercent: 0,
        transferredBytes: 0,
        totalBytes: 0,
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.downloadPromise = null
      this.installScheduled = false
      this.setState({
        enabled: true,
        status: 'idle',
        availableVersion: null,
        error: null,
        checkedAt: Date.now(),
        progressPercent: null,
        transferredBytes: 0,
        totalBytes: 0,
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      this.setState({
        enabled: true,
        status: 'downloading',
        progressPercent: Number.isFinite(progress.percent) ? progress.percent : 0,
        transferredBytes: progress.transferred,
        totalBytes: progress.total,
        error: null,
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      this.downloadPromise = null
      this.setState({
        enabled: true,
        status: 'downloaded',
        availableVersion: info.version ?? this.state.availableVersion,
        progressPercent: 100,
        transferredBytes: this.state.totalBytes || this.state.transferredBytes,
        error: null,
      })
      this.scheduleInstall()
    })

    autoUpdater.on('error', (error) => {
      this.downloadPromise = null
      this.installScheduled = false
      this.setState({
        enabled: true,
        status: 'error',
        error: error?.message ?? String(error),
        checkedAt: Date.now(),
      })
    })

    void this.checkForUpdates()
    this.checkTimer = setInterval(() => {
      void this.checkForUpdates()
    }, UPDATE_CHECK_INTERVAL_MS)
  }

  getState(): AppUpdateState {
    return {
      ...this.state,
      currentVersion: app.getVersion(),
    }
  }

  async applyUpdate(): Promise<{ success: boolean; error?: string }> {
    if (!this.state.enabled) {
      return { success: false, error: this.state.error ?? 'Auto update is not available.' }
    }

    if (this.state.status === 'downloaded') {
      this.scheduleInstall()
      return { success: true }
    }

    if (this.state.status === 'downloading') {
      return { success: true }
    }

    if (this.state.status !== 'available' && this.state.availableVersion === null) {
      return { success: false, error: 'No update is available.' }
    }

    try {
      if (!this.downloadPromise) {
        this.setState({
          status: 'downloading',
          error: null,
          progressPercent: this.state.progressPercent ?? 0,
        })
        this.downloadPromise = autoUpdater.downloadUpdate()
      }

      await this.downloadPromise
      return { success: true }
    } catch (error) {
      this.downloadPromise = null
      const message = error instanceof Error ? error.message : String(error)
      this.setState({
        status: 'error',
        error: message,
      })
      return { success: false, error: message }
    }
  }

  async checkForUpdates(): Promise<{ success: boolean; error?: string }> {
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') {
      return { success: true }
    }

    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.setState({
        enabled: true,
        status: 'error',
        error: message,
        checkedAt: Date.now(),
      })
      return { success: false, error: message }
    }
  }

  private scheduleInstall(): void {
    if (this.installScheduled) return
    this.installScheduled = true
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true)
    }, 1200)
  }

  private setState(next: Partial<AppUpdateState>): void {
    this.state = {
      ...this.state,
      ...next,
      currentVersion: app.getVersion(),
    }
    this.emitState()
  }

  private emitState(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send(UPDATE_STATE_CHANNEL, this.getState())
  }
}
