export type DiagnosticState = 'healthy' | 'degraded' | 'offline' | 'unknown'

export interface NetworkStageResult {
  key: 'gateway' | 'isp' | 'dns' | 'internet'
  label: string
  target: string | null
  successes: number
  attempts: number
  latencyMs: number | null
  status: DiagnosticState
}

export interface NetworkHistorySample {
  timestamp: number
  status: DiagnosticState
  latencyMs: number | null
  lossPercent: number
}

export interface NetworkOutage {
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  reason: string
}

export interface NetworkMonitorSettings {
  enabled: boolean
  intervalSeconds: 15 | 30 | 60 | 300
  externalTarget: string
  retentionDays: 7 | 30 | 90
  autoWeeklyReport: boolean
  reportWeekday: number
}

export interface NetworkHealthSnapshot {
  checkedAt: number
  overallStatus: DiagnosticState
  summary: string
  stages: NetworkStageResult[]
  availabilityPercent: number
  lossPercent: number
  averageLatencyMs: number | null
  p95LatencyMs: number | null
  outageCount24h: number
  samples24h: NetworkHistorySample[]
  outages7d: NetworkOutage[]
  routeSummary: string
  settings: NetworkMonitorSettings
}

export type StartupItemType = 'registry' | 'startup' | 'task' | 'service'

export interface BootHistoryEntry {
  timestamp: number
  totalSeconds: number
  loginSeconds: number
  postLoginSeconds: number
}

export interface StartupItem {
  id: string
  name: string
  type: StartupItemType
  location: string
  entryName: string
  command: string
  publisher: string
  enabled: boolean
  requiresAdmin: boolean
  manageable: boolean
  measuredDelaySeconds: number | null
  averageDelaySeconds: number | null
  measuredCount: number
  impact: 'high' | 'medium' | 'low' | 'unknown'
}

export interface BootOptimizationChange {
  id: string
  itemId: string
  itemName: string
  action: 'disabled' | 'restored'
  changedAt: number
  restoredAt: number | null
}

export interface BootOptimizationSnapshot {
  checkedAt: number
  latestBoot: BootHistoryEntry | null
  averageBootSeconds: number | null
  improvementSeconds: number | null
  bootHistory: BootHistoryEntry[]
  startupItems: StartupItem[]
  changes: BootOptimizationChange[]
  restorePointAutoCreate: boolean
}

export interface DiagnosticsResult<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}
