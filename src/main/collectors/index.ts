import { BrowserWindow } from 'electron'
import { collectSystemMetrics, warmupSystemInfo, SystemMetrics } from './system-metrics'
import { collectTopProcesses, ProcessInfo } from './process-collector'
import { EventLogCollector, EventLogResult } from './event-log-collector'
import { WindowsUpdateCollector, WindowsUpdateResult } from './windows-update-collector'
import { SystemMaintenanceService, SystemMaintenanceReport } from '../maintenance/system-maintenance'

export interface FullSnapshot {
  metrics: SystemMetrics
  processes: ProcessInfo[]
  events: EventLogResult
  windowsUpdate: WindowsUpdateResult
}

export class DataCollectorService {
  private win: BrowserWindow | null = null
  private eventLogCollector = new EventLogCollector()
  private windowsUpdateCollector = new WindowsUpdateCollector()
  private maintenanceService = new SystemMaintenanceService()

  private metricsTimer: ReturnType<typeof setInterval> | null = null
  private slowTimer: ReturnType<typeof setInterval> | null = null
  private eventTimer: ReturnType<typeof setInterval> | null = null
  private updateTimer: ReturnType<typeof setInterval> | null = null
  private autoUpdateApplyTimer: ReturnType<typeof setInterval> | null = null

  private lastMetrics: SystemMetrics | null = null
  private lastProcesses: ProcessInfo[] = []

  async initialize(win: BrowserWindow): Promise<void> {
    this.win = win
    await warmupSystemInfo()

    this.metricsTimer = setInterval(async () => {
      try {
        this.lastMetrics = await collectSystemMetrics()
        this.win?.webContents.send('system:metricsUpdate', {
          metrics: this.lastMetrics,
          processes: this.lastProcesses,
        })
      } catch {
        // ignore metrics errors
      }
    }, 3000)

    this.slowTimer = setInterval(async () => {
      try {
        this.lastProcesses = await collectTopProcesses()
        this.win?.webContents.send('system:processesUpdate', this.lastProcesses)
      } catch {
        // ignore process errors
      }
    }, 10000)

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

    this.lastMetrics = await collectSystemMetrics()
    this.lastProcesses = await collectTopProcesses()
    this.win?.webContents.send('system:metricsUpdate', {
      metrics: this.lastMetrics,
      processes: this.lastProcesses,
    })
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

  async getFreshSnapshot(): Promise<FullSnapshot> {
    const [metrics, processes, events] = await Promise.all([
      collectSystemMetrics(),
      collectTopProcesses(),
      this.eventLogCollector.collect(),
    ])
    this.lastMetrics = metrics
    this.lastProcesses = processes
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

  destroy(): void {
    if (this.metricsTimer) clearInterval(this.metricsTimer)
    if (this.slowTimer) clearInterval(this.slowTimer)
    if (this.eventTimer) clearInterval(this.eventTimer)
    if (this.updateTimer) clearInterval(this.updateTimer)
    if (this.autoUpdateApplyTimer) clearInterval(this.autoUpdateApplyTimer)
    this.win = null
  }
}
