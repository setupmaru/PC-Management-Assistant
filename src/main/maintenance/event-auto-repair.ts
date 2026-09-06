import type { WindowsEvent } from '../collectors/event-log-collector'
import {
  EventAutoRepairHistoryEntry,
  loadEventAutoRepairEnabled,
  loadEventAutoRepairHistory,
  saveEventAutoRepairEnabled,
  saveEventAutoRepairHistory,
} from '../store'
import {
  createInitialEventAutoRepairState,
  EventAutoRepairAction,
  EventAutoRepairState,
} from '../../shared/event-repair'
import { runPowerShell } from '../utils/powershell'

interface EventRepairRule {
  id: string
  title: string
  providerNames: string[]
  eventIds: number[]
  script: string
  successDetail: string
  timeoutMs: number
}

const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ATTEMPTS = 3
const MAX_HISTORY_ENTRIES = 200

const DNS_REPAIR_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Clear-DnsClientCache -ErrorAction Stop
  Write-Output 'ok'
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`

const TIME_REPAIR_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  $service = Get-Service -Name W32Time -ErrorAction Stop
  if ($service.Status -ne 'Running') {
    Start-Service -Name W32Time -ErrorAction Stop
  }
  $output = & w32tm.exe /resync /nowait 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ($output -join ' ')
  }
  Write-Output 'ok'
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`

const WINDOWS_UPDATE_REPAIR_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  $usoClient = Join-Path $env:SystemRoot 'System32\\UsoClient.exe'
  if (!(Test-Path -LiteralPath $usoClient)) {
    throw 'UsoClient.exe를 찾을 수 없습니다.'
  }
  Start-Process -FilePath $usoClient -ArgumentList 'StartScan' -WindowStyle Hidden -ErrorAction Stop
  Write-Output 'ok'
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`

const REPAIR_RULES: EventRepairRule[] = [
  {
    id: 'dns-client-cache',
    title: 'DNS 클라이언트 복구',
    providerNames: ['microsoft-windows-dns-client', 'dns client events'],
    eventIds: [1014],
    script: DNS_REPAIR_SCRIPT,
    successDetail: 'DNS 캐시를 초기화했습니다.',
    timeoutMs: 15_000,
  },
  {
    id: 'windows-time-resync',
    title: 'Windows 시간 동기화 복구',
    providerNames: ['microsoft-windows-time-service', 'time-service'],
    eventIds: [129, 134, 142],
    script: TIME_REPAIR_SCRIPT,
    successDetail: 'Windows 시간 동기화를 다시 요청했습니다.',
    timeoutMs: 20_000,
  },
  {
    id: 'windows-update-rescan',
    title: 'Windows Update 복구',
    providerNames: ['microsoft-windows-windowsupdateclient', 'windowsupdateclient'],
    eventIds: [20, 25, 31, 34, 35],
    script: WINDOWS_UPDATE_REPAIR_SCRIPT,
    successDetail: 'Windows Update 다시 검색을 요청했습니다.',
    timeoutMs: 20_000,
  },
]

function normalizedProvider(event: WindowsEvent): string {
  return String(event.ProviderName ?? '').trim().toLowerCase()
}

function ruleForEvent(event: WindowsEvent): EventRepairRule | null {
  const provider = normalizedProvider(event)
  return REPAIR_RULES.find((rule) => (
    rule.eventIds.includes(Number(event.Id))
    && rule.providerNames.some((name) => provider === name || provider.endsWith(`/${name}`))
  )) ?? null
}

function fingerprintForEvent(rule: EventRepairRule, event: WindowsEvent): string {
  return [rule.id, normalizedProvider(event), Number(event.Id), String(event.TimeCreated ?? '')].join('|')
}

export class EventAutoRepairService {
  private initialized = false
  private enabled = true
  private history = new Map<string, EventAutoRepairHistoryEntry>()
  private state = createInitialEventAutoRepairState()
  private runningPromise: Promise<EventAutoRepairState> | null = null

  getState(): EventAutoRepairState {
    this.ensureInitialized()
    return { ...this.state, actions: [...this.state.actions] }
  }

  setEnabled(enabled: boolean): EventAutoRepairState {
    this.ensureInitialized()
    this.enabled = enabled
    saveEventAutoRepairEnabled(enabled)
    this.state = {
      ...this.state,
      enabled,
      running: this.runningPromise !== null,
      summary: enabled
        ? '이벤트 자동 복구가 켜졌습니다.'
        : '이벤트 자동 복구가 꺼져 있습니다.',
    }
    return this.getState()
  }

  async process(events: WindowsEvent[], forceRetry = false): Promise<EventAutoRepairState> {
    this.ensureInitialized()
    if (this.runningPromise) return this.runningPromise

    this.runningPromise = this.processInternal(events, forceRetry)
    try {
      return await this.runningPromise
    } finally {
      this.runningPromise = null
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return
    this.initialized = true
    this.enabled = loadEventAutoRepairEnabled()
    this.history = new Map(loadEventAutoRepairHistory().map((entry) => [entry.fingerprint, entry]))
    this.pruneHistory(Date.now())
    this.state = createInitialEventAutoRepairState(this.enabled)
  }

  private shouldAttempt(fingerprint: string, now: number, forceRetry: boolean): boolean {
    const previous = this.history.get(fingerprint)
    if (!previous) return true
    if (previous.succeeded || previous.attempts >= MAX_ATTEMPTS) return false
    return forceRetry || now - previous.lastAttemptAt >= RETRY_COOLDOWN_MS
  }

  private async processInternal(events: WindowsEvent[], forceRetry: boolean): Promise<EventAutoRepairState> {
    const now = Date.now()
    const supported = events
      .map((event) => ({ event, rule: ruleForEvent(event) }))
      .filter((item): item is { event: WindowsEvent; rule: EventRepairRule } => item.rule !== null)

    const pending = supported.filter(({ event, rule }) => (
      this.shouldAttempt(fingerprintForEvent(rule, event), now, forceRetry)
    ))

    if (!this.enabled) {
      this.state = {
        ...this.state,
        enabled: false,
        running: false,
        supportedEventCount: supported.length,
        pendingEventCount: pending.length,
        summary: '이벤트 자동 복구가 꺼져 있습니다.',
      }
      return this.getState()
    }

    if (pending.length === 0) {
      this.state = {
        ...this.state,
        enabled: true,
        running: false,
        supportedEventCount: supported.length,
        pendingEventCount: 0,
        summary: supported.length === 0
          ? '자동 복구 가능한 새 이벤트가 없습니다.'
          : this.state.actions.length > 0
            ? this.state.summary
            : '지원되는 이벤트는 이미 처리했거나 재시도 대기 중입니다.',
      }
      return this.getState()
    }

    this.state = {
      ...this.state,
      enabled: true,
      running: true,
      supportedEventCount: supported.length,
      pendingEventCount: pending.length,
      summary: `지원되는 이벤트 ${pending.length}건을 자동 복구하는 중입니다.`,
    }

    const actions: EventAutoRepairAction[] = []
    for (const rule of REPAIR_RULES) {
      if (!this.enabled) break
      const ruleEvents = pending.filter((item) => item.rule.id === rule.id)
      if (ruleEvents.length === 0) continue

      let succeeded = false
      let detail = rule.successDetail
      try {
        await runPowerShell(rule.script, rule.timeoutMs)
        succeeded = true
      } catch (error) {
        detail = error instanceof Error ? error.message : String(error)
      }

      const attemptedAt = Date.now()
      for (const { event } of ruleEvents) {
        const fingerprint = fingerprintForEvent(rule, event)
        const previous = this.history.get(fingerprint)
        this.history.set(fingerprint, {
          fingerprint,
          ruleId: rule.id,
          lastAttemptAt: attemptedAt,
          attempts: (previous?.attempts ?? 0) + 1,
          succeeded,
        })
      }

      actions.push({
        ruleId: rule.id,
        title: rule.title,
        status: succeeded ? 'success' : 'failed',
        eventCount: ruleEvents.length,
        detail,
        attemptedAt,
      })
    }

    this.pruneHistory(Date.now())
    saveEventAutoRepairHistory([...this.history.values()])

    const successCount = actions.filter((action) => action.status === 'success').length
    const failedCount = actions.length - successCount
    this.state = {
      enabled: this.enabled,
      running: false,
      supportedEventCount: supported.length,
      pendingEventCount: 0,
      lastRunAt: Date.now(),
      summary: !this.enabled
        ? '이벤트 자동 복구가 꺼져 있습니다.'
        : failedCount === 0
          ? `자동 복구 ${successCount}개 작업을 완료했습니다.`
          : `자동 복구 성공 ${successCount}개 · 실패 ${failedCount}개`,
      actions,
    }
    return this.getState()
  }

  private pruneHistory(now: number): void {
    const retained = [...this.history.values()]
      .filter((entry) => now - entry.lastAttemptAt <= HISTORY_RETENTION_MS)
      .sort((left, right) => right.lastAttemptAt - left.lastAttemptAt)
      .slice(0, MAX_HISTORY_ENTRIES)
    this.history = new Map(retained.map((entry) => [entry.fingerprint, entry]))
  }
}
