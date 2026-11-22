import { BrowserWindow } from 'electron'
import { collectSystemMetrics, SystemMetrics } from './system-metrics'
import { collectTopProcesses, ProcessInfo } from './process-collector'
import { EventLogCollector, EventLogResult } from './event-log-collector'
import { WindowsUpdateCollector, WindowsUpdateResult } from './windows-update-collector'
import { SystemMaintenanceService, SystemMaintenanceReport } from '../maintenance/system-maintenance'
import { NetworkMonitorService } from '../diagnostics/network-monitor'
import { BootOptimizerService } from '../diagnostics/boot-optimizer'
import {
  BootOptimizationSnapshot,
  NetworkHealthSnapshot,
  NetworkMonitorSettings,
} from '../../shared/diagnostics'
import { EventAutoRepairState } from '../../shared/event-repair'

export interface FullSnapshot {
  metrics: SystemMetrics
  processes: ProcessInfo[]
  events: EventLogResult
  windowsUpdate: WindowsUpdateResult
}

const FOREGROUND_METRICS_INTERVAL_MS = 3_000
const BACKGROUND_METRICS_INTERVAL_MS = 60_000
const PROCESS_INTERVAL_MS = 10_000

export class DataCollectorService {
  private readonly isWindows = process.platform === 'win32'
  private win: BrowserWindow | null = null
  private eventLogCollector = new EventLogCollector()
  private windowsUpdateCollector = new WindowsUpdateCollector()
  private maintenanceService = new SystemMaintenanceService()
  private networkMonitor = new NetworkMonitorService()
  private bootOptimizer = new BootOptimizerService()

  private metricsTimer: ReturnType<typeof setInterval> | null = null
  private processesTimer: ReturnType<typeof setInterval> | null = null
  private eventTimer: ReturnType<typeof setInterval> | null = null
  private updateTimer: ReturnType<typeof setInterval> | null = null
  private autoUpdateApplyTimer: ReturnType<typeof setInterval> | null = null

  private lastMetrics: SystemMetrics | null = null
  private lastProcesses: ProcessInfo[] = []
  private dashboardVisible: boolean | null = null
  private metricsCollection: Promise<SystemMetrics> | null = null
  private processCollection: Promise<ProcessInfo[]> | null = null

  async initialize(win: BrowserWindow): Promise<void> {
    this.win = win
    win.on('show', this.updateDashboardPolling)
      .on('hide', this.updateDashboardPolling)
      .on('minimize', this.updateDashboardPolling)
      .on('restore', this.updateDashboardPolling)
    this.updateDashboardPolling()

    if (this.isWindows) {
      this.bootOptimizer.initialize((snapshot) => {
        this.win?.webContents.send('diagnostics:bootUpdate', snapshot)
      })
      this.networkMonitor.initialize((snapshot) => {
        this.win?.webContents.send('diagnostics:networkUpdate', snapshot)
      }, () => this.bootOptimizer.createMarkdownReport()).catch(() => {})
    }

    if (this.isWindows) {
      this.eventTimer = setInterval(async () => {
        try {
          const events = await this.eventLogCollector.collect()
          this.win?.webContents.send('system:eventsUpdate', events)
        } catch {
          // ignore event log errors
        }
      }, 60000)

      this.updateTimer = setInterval(async () => {
        try {
          this.win?.webContents.send('system:windowsUpdateUpdate', {
            ...this.windowsUpdateCollector.getLastResult(),
            isChecking: true,
          })
          const result = await this.windowsUpdateCollector.collect(true)
          this.win?.webContents.send('system:windowsUpdateUpdate', result)
        } catch {
          // ignore windows update check errors
        }
      }, 30 * 60 * 1000)

      // Auto apply Windows updates every 6 hours.
      this.autoUpdateApplyTimer = setInterval(async () => {
        try {
          const step = await this.maintenanceService.runAutoWindowsUpdateApply()
          if (!step) return
          const result = await this.windowsUpdateCollector.collect(true)
          this.win?.webContents.send('system:windowsUpdateUpdate', result)
        } catch {
          // ignore auto apply errors
        }
      }, 6 * 60 * 60 * 1000)
    }

    await this.metricsCollection?.catch(() => {})
    if (this.isWindows && this.win) {
      await this.eventLogCollector.collect(true)

      this.win?.webContents.send('system:windowsUpdateUpdate', {
        ...this.windowsUpdateCollector.getLastResult(),
        isChecking: true,
      })
      this.windowsUpdateCollector.collect(true).then((result) => {
        this.win?.webContents.send('system:windowsUpdateUpdate', result)
      }).catch(() => {
        // ignore windows update bootstrap errors
      })
    }
  }

  private updateDashboardPolling = (): void => {
    const win = this.win
    if (!win || win.isDestroyed()) return
    const visible = win.isVisible() && !win.isMinimized()
    if (visible === this.dashboardVisible) return
    const firstSample = this.dashboardVisible === null
    this.stopDashboardPolling()
    this.dashboardVisible = visible

    const pollMetrics = () => {
      if (!this.metricsCollection) void this.sampleMetrics().catch(() => {})
    }
    this.metricsTimer = setInterval(pollMetrics, visible
      ? FOREGROUND_METRICS_INTERVAL_MS
      : BACKGROUND_METRICS_INTERVAL_MS)

    if (visible) {
      const pollProcesses = () => {
        if (!this.processCollection) void this.sampleProcesses().catch(() => {})
      }
      this.processesTimer = setInterval(pollProcesses, PROCESS_INTERVAL_MS)
      pollProcesses()
    }
    if (visible || firstSample) pollMetrics()
  }

  private stopDashboardPolling(): void {
    if (this.metricsTimer) clearInterval(this.metricsTimer)
    if (this.processesTimer) clearInterval(this.processesTimer)
    this.metricsTimer = null
    this.processesTimer = null
  }

  private sampleMetrics(): Promise<SystemMetrics> {
    if (!this.metricsCollection) {
      this.metricsCollection = collectSystemMetrics().then((metrics) => {
        this.lastMetrics = metrics
        this.sendDashboardUpdate('system:metricsUpdate', { metrics })
        return metrics
      }).finally(() => { this.metricsCollection = null })
    }
    return this.metricsCollection
  }

  private sampleProcesses(): Promise<ProcessInfo[]> {
    if (!this.processCollection) {
      this.processCollection = collectTopProcesses().then((processes) => {
        this.lastProcesses = processes
        this.sendDashboardUpdate('system:processesUpdate', processes)
        return processes
      }).finally(() => { this.processCollection = null })
    }
    return this.processCollection
  }

  private sendDashboardUpdate(channel: string, data: unknown): void {
    if (this.dashboardVisible && this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, data)
    }
  }

  async getFreshSnapshot(): Promise<FullSnapshot> {
    const [metrics, processes, events] = await Promise.all([
      this.sampleMetrics(),
      this.sampleProcesses(),
      this.isWindows
        ? this.eventLogCollector.collect()
        : Promise.resolve(this.eventLogCollector.getLastResult()),
    ])
    return {
      metrics,
      processes,
      events,
      windowsUpdate: this.windowsUpdateCollector.getLastResult(),
    }
  }

  getLastSnapshot(): Partial<FullSnapshot> {
    return {
      metrics: this.lastMetrics ?? undefined,
      processes: this.lastProcesses,
      events: this.eventLogCollector.getLastResult(),
      windowsUpdate: this.windowsUpdateCollector.getLastResult(),
    }
  }

  async checkWindowsUpdates(): Promise<WindowsUpdateResult> {
    return this.windowsUpdateCollector.collect(true)
  }

  async setEventAutoRepairEnabled(enabled: boolean): Promise<EventAutoRepairState> {
    const state = await this.eventLogCollector.setAutoRepairEnabled(enabled)
    this.win?.webContents.send('system:eventsUpdate', this.eventLogCollector.getLastResult())
    return state
  }

  async runEventAutoRepair(): Promise<EventAutoRepairState> {
    const state = await this.eventLogCollector.runAutoRepair()
    this.win?.webContents.send('system:eventsUpdate', this.eventLogCollector.getLastResult())
    return state
  }

  async runSystemMaintenance(): Promise<SystemMaintenanceReport> {
    const report = await this.maintenanceService.runFullMaintenance()
    try {
      const result = await this.windowsUpdateCollector.collect(true)
      this.win?.webContents.send('system:windowsUpdateUpdate', result)
    } catch {
      // ignore refresh failures
    }
    return report
  }

  getLastMaintenanceReport(): SystemMaintenanceReport | null {
    return this.maintenanceService.getLastReport()
  }

  getNetworkHealth(): NetworkHealthSnapshot | null {
    return this.networkMonitor.getSnapshot()
  }

  async measureNetworkNow(): Promise<NetworkHealthSnapshot> {
    return this.networkMonitor.measureNow()
  }

  async updateNetworkSettings(settings: Partial<NetworkMonitorSettings>): Promise<NetworkHealthSnapshot> {
    return this.networkMonitor.updateSettings(settings)
  }

  clearNetworkHistory(): NetworkHealthSnapshot | null {
    return this.networkMonitor.clearHistory()
  }

  createNetworkReport(days: number): string {
    return this.networkMonitor.createMarkdownReport(days)
  }

  getBootOptimization(): BootOptimizationSnapshot | null {
    return this.bootOptimizer.getSnapshot()
  }

  async refreshBootOptimization(): Promise<BootOptimizationSnapshot> {
    return this.bootOptimizer.refresh()
  }

  setRestorePointAutoCreate(enabled: boolean): BootOptimizationSnapshot | null {
    return this.bootOptimizer.setRestorePointAutoCreate(enabled)
  }

  async createSystemRestorePoint(): Promise<void> {
    return this.bootOptimizer.createRestorePoint()
  }

  async disableStartupItem(itemId: string): Promise<BootOptimizationSnapshot> {
    return this.bootOptimizer.disableItem(itemId)
  }

  async restoreStartupChange(changeId: string): Promise<BootOptimizationSnapshot> {
    return this.bootOptimizer.restoreChange(changeId)
  }

  async restoreAllStartupChanges(): Promise<BootOptimizationSnapshot> {
    return this.bootOptimizer.restoreAll()
  }

  createBootReport(): string {
    return this.bootOptimizer.createMarkdownReport()
  }

  destroy(): void {
    this.win?.off('show', this.updateDashboardPolling)
      .off('hide', this.updateDashboardPolling)
      .off('minimize', this.updateDashboardPolling)
      .off('restore', this.updateDashboardPolling)
    this.stopDashboardPolling()
    if (this.eventTimer) clearInterval(this.eventTimer)
    if (this.updateTimer) clearInterval(this.updateTimer)
    if (this.autoUpdateApplyTimer) clearInterval(this.autoUpdateApplyTimer)
    this.networkMonitor.destroy()
    this.win = null
  }
}
