import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { runPowerShell } from '../utils/powershell'
import {
  DiagnosticState,
  NetworkHealthSnapshot,
  NetworkHistorySample,
  NetworkMonitorSettings,
  NetworkOutage,
  NetworkStageResult,
} from '../../shared/diagnostics'

interface PersistedNetworkData {
  settings: NetworkMonitorSettings
  samples: NetworkHistorySample[]
  outages: NetworkOutage[]
  lastWeeklyReportAt: number | null
}

interface NetworkTargets {
  gateway: string | null
  isp: string | null
  dns: string | null
}

interface RawPingResult {
  Key: NetworkStageResult['key']
  Label: string
  Target: string | null
  Successes: number
  Attempts: number
  LatencyMs: number | null
}

const DEFAULT_SETTINGS: NetworkMonitorSettings = {
  enabled: true,
  intervalSeconds: 15,
  externalTarget: '1.1.1.1',
  retentionDays: 30,
  autoWeeklyReport: false,
  reportWeekday: 1,
}

const VALID_INTERVALS = new Set([15, 30, 60, 300])
const VALID_RETENTION_DAYS = new Set([7, 30, 90])
const MIN_PERSIST_INTERVAL_MS = 60_000

function safeTarget(value: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^(?=.{1,253}$)[a-zA-Z0-9.-]+$/.test(normalized)) {
    throw new Error('외부 측정 대상은 올바른 IP 주소나 호스트 이름이어야 합니다.')
  }
  return normalized
}

function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

function stateFromPing(successes: number, attempts: number): DiagnosticState {
  if (attempts === 0) return 'unknown'
  if (successes === 0) return 'offline'
  if (successes < attempts) return 'degraded'
  return 'healthy'
}

function stageLabel(key: NetworkStageResult['key']): string {
  if (key === 'gateway') return '공유기'
  if (key === 'isp') return 'ISP 구간'
  if (key === 'dns') return 'DNS'
  return '인터넷'
}

export class NetworkMonitorService {
  private settings: NetworkMonitorSettings = { ...DEFAULT_SETTINGS }
  private samples: NetworkHistorySample[] = []
  private outages: NetworkOutage[] = []
  private targets: NetworkTargets = { gateway: null, isp: null, dns: null }
  private snapshot: NetworkHealthSnapshot | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private measuring = false
  private lastPersistedSampleAt = 0
  private lastWeeklyReportAt: number | null = null
  private onUpdate: ((snapshot: NetworkHealthSnapshot) => void) | null = null
  private createWeeklySupplement: (() => string) | null = null
  private dataFile = ''

  async initialize(
    onUpdate: (snapshot: NetworkHealthSnapshot) => void,
    createWeeklySupplement?: () => string,
  ): Promise<void> {
    this.onUpdate = onUpdate
    this.createWeeklySupplement = createWeeklySupplement ?? null
    this.dataFile = path.join(app.getPath('userData'), 'network-monitor.json')
    this.load()
    await this.discoverTargets().catch(() => {})
    await this.measureNow()
    this.schedule()
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.persist()
  }

  getSnapshot(): NetworkHealthSnapshot | null {
    return this.snapshot
  }

  async measureNow(): Promise<NetworkHealthSnapshot> {
    if (this.measuring && this.snapshot) return this.snapshot
    this.measuring = true

    try {
      if (!this.targets.gateway || !this.targets.dns) {
        await this.discoverTargets().catch(() => {})
      }

      const rawStages = await this.runMeasurement()
      const stages = rawStages.map((stage) => ({
        key: stage.Key,
        label: stage.Label || stageLabel(stage.Key),
        target: stage.Target || null,
        successes: Number(stage.Successes) || 0,
        attempts: Number(stage.Attempts) || 0,
        latencyMs: stage.LatencyMs == null ? null : Math.round(Number(stage.LatencyMs)),
        status: stateFromPing(Number(stage.Successes) || 0, Number(stage.Attempts) || 0),
      })) satisfies NetworkStageResult[]

      this.snapshot = this.buildSnapshot(stages, Date.now())
      this.recordSnapshot(this.snapshot)
      this.snapshot = this.buildSnapshot(stages, this.snapshot.checkedAt)
      this.onUpdate?.(this.snapshot)
      await this.maybeWriteWeeklyReport()
      return this.snapshot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stages: NetworkStageResult[] = (['gateway', 'isp', 'dns', 'internet'] as const).map((key) => ({
        key,
        label: stageLabel(key),
        target: key === 'gateway' ? this.targets.gateway : key === 'isp' ? this.targets.isp : key === 'dns' ? this.targets.dns : this.settings.externalTarget,
        successes: 0,
        attempts: key === 'isp' && !this.targets.isp ? 0 : 1,
        latencyMs: null,
        status: key === 'isp' && !this.targets.isp ? 'unknown' : 'offline',
      }))
      this.snapshot = this.buildSnapshot(stages, Date.now(), `측정 실패: ${message}`)
      this.recordSnapshot(this.snapshot)
      this.snapshot = this.buildSnapshot(stages, this.snapshot.checkedAt, `측정 실패: ${message}`)
      this.onUpdate?.(this.snapshot)
      return this.snapshot
    } finally {
      this.measuring = false
    }
  }

  async updateSettings(value: Partial<NetworkMonitorSettings>): Promise<NetworkHealthSnapshot> {
    const intervalSeconds = Number(value.intervalSeconds ?? this.settings.intervalSeconds)
    const retentionDays = Number(value.retentionDays ?? this.settings.retentionDays)
    const reportWeekday = Number(value.reportWeekday ?? this.settings.reportWeekday)

    if (!VALID_INTERVALS.has(intervalSeconds)) throw new Error('지원하지 않는 측정 주기입니다.')
    if (!VALID_RETENTION_DAYS.has(retentionDays)) throw new Error('지원하지 않는 기록 보관 기간입니다.')
    if (!Number.isInteger(reportWeekday) || reportWeekday < 0 || reportWeekday > 6) {
      throw new Error('주간 리포트 요일이 올바르지 않습니다.')
    }

    const nextTarget = safeTarget(value.externalTarget ?? this.settings.externalTarget)
    const targetChanged = nextTarget !== this.settings.externalTarget
    this.settings = {
      enabled: value.enabled ?? this.settings.enabled,
      intervalSeconds: intervalSeconds as NetworkMonitorSettings['intervalSeconds'],
      externalTarget: nextTarget,
      retentionDays: retentionDays as NetworkMonitorSettings['retentionDays'],
      autoWeeklyReport: value.autoWeeklyReport ?? this.settings.autoWeeklyReport,
      reportWeekday,
    }

    if (targetChanged) await this.discoverTargets().catch(() => {})
    this.prune()
    this.persist()
    this.schedule()
    return await this.measureNow()
  }

  clearHistory(): NetworkHealthSnapshot | null {
    this.samples = []
    this.outages = []
    this.lastPersistedSampleAt = 0
    this.persist()
    if (this.snapshot) {
      this.snapshot = this.buildSnapshot(this.snapshot.stages, this.snapshot.checkedAt)
      this.onUpdate?.(this.snapshot)
    }
    return this.snapshot
  }

  createMarkdownReport(days: number): string {
    const rangeDays = [1, 7, 30].includes(days) ? days : 7
    const since = Date.now() - rangeDays * 24 * 60 * 60 * 1000
    const samples = this.samples.filter((sample) => sample.timestamp >= since)
    const outages = this.outages.filter((outage) => (outage.endedAt ?? Date.now()) >= since)
    const available = samples.filter((sample) => sample.status === 'healthy' || sample.status === 'degraded').length
    const availability = samples.length > 0 ? (available / samples.length) * 100 : 0
    const avgLoss = samples.length > 0 ? samples.reduce((sum, item) => sum + item.lossPercent, 0) / samples.length : 0
    const latencies = samples.flatMap((sample) => sample.latencyMs == null ? [] : [sample.latencyMs])
    const avgLatency = latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null
    const p95 = percentile(latencies, 0.95)
    const generatedAt = new Date().toLocaleString('ko-KR')

    const lines = [
      '# PC Management Assistant 네트워크 리포트',
      '',
      `- 생성 시각: ${generatedAt}`,
      `- 분석 범위: 최근 ${rangeDays}일`,
      `- 외부 측정 대상: ${this.settings.externalTarget}`,
      `- 가용률: ${availability.toFixed(2)}%`,
      `- 평균 손실률: ${avgLoss.toFixed(2)}%`,
      `- 평균 지연: ${avgLatency == null ? '-' : `${avgLatency.toFixed(0)}ms`}`,
      `- P95 지연: ${p95 == null ? '-' : `${p95.toFixed(0)}ms`}`,
      `- 장애 건수: ${outages.length}건`,
      '',
      '## 장애 내역',
      '',
    ]

    if (outages.length === 0) {
      lines.push('기록된 장애가 없습니다.')
    } else {
      lines.push('| 시작 | 종료 | 지속 시간 | 원인 |', '|---|---|---:|---|')
      for (const outage of outages) {
        const end = outage.endedAt ? new Date(outage.endedAt).toLocaleString('ko-KR') : '진행 중'
        const duration = outage.durationMs == null ? '-' : `${Math.max(1, Math.round(outage.durationMs / 1000))}초`
        lines.push(`| ${new Date(outage.startedAt).toLocaleString('ko-KR')} | ${end} | ${duration} | ${outage.reason} |`)
      }
    }

    lines.push('', '## 최근 경로', '', this.snapshot?.routeSummary || '경로 정보 없음', '')
    return lines.join('\n')
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.settings.enabled) return

    this.timer = setTimeout(async () => {
      await this.measureNow().catch(() => {})
      this.schedule()
    }, this.settings.intervalSeconds * 1000)
  }

  private async discoverTargets(): Promise<void> {
    const target = safeTarget(this.settings.externalTarget)
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' |
  Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' } |
  Sort-Object { $_.RouteMetric + $_.InterfaceMetric } |
  Select-Object -First 1
$gateway = if ($route) { [string]$route.NextHop } else { $null }
$dns = Get-DnsClientServerAddress -AddressFamily IPv4 |
  Where-Object { $_.ServerAddresses.Count -gt 0 } |
  ForEach-Object { $_.ServerAddresses } |
  Where-Object { $_ -and $_ -ne '0.0.0.0' } |
  Select-Object -First 1
$traceText = (& tracert.exe -d -h 4 -w 700 ${psLiteral(target)} 2>$null) -join "\n"
$matches = [regex]::Matches($traceText, '(?<![0-9])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9])')
$isp = $null
foreach ($match in $matches) {
  $ip = $match.Value
  if ($ip -ne $gateway -and $ip -ne ${psLiteral(target)} -and $ip -ne '127.0.0.1') {
    $isp = $ip
    break
  }
}
[PSCustomObject]@{ Gateway = $gateway; Dns = [string]$dns; Isp = $isp } | ConvertTo-Json -Compress
`
    const output = await runPowerShell(script, 15_000)
    const parsed = JSON.parse(output) as { Gateway?: string; Dns?: string; Isp?: string }
    this.targets = {
      gateway: parsed.Gateway || null,
      dns: parsed.Dns || null,
      isp: parsed.Isp || null,
    }
  }

  private async runMeasurement(): Promise<RawPingResult[]> {
    const definitions = [
      { key: 'gateway', label: '공유기', target: this.targets.gateway, count: 2 },
      { key: 'isp', label: 'ISP 구간', target: this.targets.isp, count: 1 },
      { key: 'dns', label: 'DNS', target: this.targets.dns, count: 1 },
      { key: 'internet', label: '인터넷', target: safeTarget(this.settings.externalTarget), count: 3 },
    ] as const

    const json = JSON.stringify(definitions).replace(/'/g, "''")
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$definitions = ConvertFrom-Json '${json}'
$results = foreach ($definition in $definitions) {
  $target = [string]$definition.target
  $attempts = if ($target) { [int]$definition.count } else { 0 }
  $successes = 0
  $latencies = @()
  if ($target) {
    $ping = New-Object System.Net.NetworkInformation.Ping
    for ($i = 0; $i -lt $attempts; $i++) {
      try {
        $reply = $ping.Send($target, 1200)
        if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
          $successes++
          $latencies += [double]$reply.RoundtripTime
        }
      } catch {}
    }
    $ping.Dispose()
  }
  $latency = if ($latencies.Count -gt 0) { [math]::Round(($latencies | Measure-Object -Average).Average) } else { $null }
  [PSCustomObject]@{
    Key = [string]$definition.key
    Label = [string]$definition.label
    Target = if ($target) { $target } else { $null }
    Successes = $successes
    Attempts = $attempts
    LatencyMs = $latency
  }
}
@($results) | ConvertTo-Json -Compress
`
    const output = await runPowerShell(script, 12_000)
    const parsed = JSON.parse(output) as RawPingResult | RawPingResult[]
    return Array.isArray(parsed) ? parsed : [parsed]
  }

  private buildSnapshot(stages: NetworkStageResult[], checkedAt: number, forcedSummary?: string): NetworkHealthSnapshot {
    const required = stages.filter((stage) => stage.key !== 'isp')
    const offline = required.some((stage) => stage.status === 'offline')
    const degraded = required.some((stage) => stage.status === 'degraded' || stage.status === 'unknown')
    const overallStatus: DiagnosticState = offline ? 'offline' : degraded ? 'degraded' : 'healthy'
    const internet = stages.find((stage) => stage.key === 'internet')
    const samples24h = this.samples.filter((sample) => sample.timestamp >= Date.now() - 24 * 60 * 60 * 1000)
    const availableCount = samples24h.filter((sample) => sample.status === 'healthy' || sample.status === 'degraded').length
    const availabilityPercent = samples24h.length > 0 ? (availableCount / samples24h.length) * 100 : (overallStatus === 'offline' ? 0 : 100)
    const lossPercent = samples24h.length > 0
      ? samples24h.reduce((sum, sample) => sum + sample.lossPercent, 0) / samples24h.length
      : internet?.attempts ? ((internet.attempts - internet.successes) / internet.attempts) * 100 : 100
    const latencies = samples24h.flatMap((sample) => sample.latencyMs == null ? [] : [sample.latencyMs])
    const averageLatencyMs = latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : internet?.latencyMs ?? null
    const p95LatencyMs = percentile(latencies, 0.95)
    const outages7d = this.outages.filter((outage) => (outage.endedAt ?? Date.now()) >= Date.now() - 7 * 24 * 60 * 60 * 1000)
    const outageCount24h = outages7d.filter((outage) => outage.startedAt >= Date.now() - 24 * 60 * 60 * 1000).length
    const failedLabels = required.filter((stage) => stage.status === 'offline').map((stage) => stage.label)
    const summary = forcedSummary ?? (overallStatus === 'healthy'
      ? `정상 (외부 응답 ${internet?.latencyMs ?? '-'}ms)`
      : overallStatus === 'degraded'
        ? '일부 구간의 응답이 불안정합니다.'
        : `${failedLabels.join(', ') || '네트워크'} 응답이 없습니다.`)
    const routeSummary = stages
      .filter((stage) => stage.target)
      .map((stage) => `${stage.label} ${stage.target}`)
      .join(' → ')

    return {
      checkedAt,
      overallStatus,
      summary,
      stages,
      availabilityPercent,
      lossPercent,
      averageLatencyMs,
      p95LatencyMs,
      outageCount24h,
      samples24h,
      outages7d,
      routeSummary,
      settings: { ...this.settings },
    }
  }

  private recordSnapshot(snapshot: NetworkHealthSnapshot): void {
    const internet = snapshot.stages.find((stage) => stage.key === 'internet')
    const lossPercent = internet?.attempts
      ? ((internet.attempts - internet.successes) / internet.attempts) * 100
      : 100
    const previous = this.samples[this.samples.length - 1]
    const changed = previous?.status !== snapshot.overallStatus
    if (!previous || changed || snapshot.checkedAt - this.lastPersistedSampleAt >= MIN_PERSIST_INTERVAL_MS) {
      this.samples.push({
        timestamp: snapshot.checkedAt,
        status: snapshot.overallStatus,
        latencyMs: internet?.latencyMs ?? null,
        lossPercent,
      })
      this.lastPersistedSampleAt = snapshot.checkedAt
    }

    let activeOutage: NetworkOutage | undefined
    for (let index = this.outages.length - 1; index >= 0; index--) {
      if (this.outages[index].endedAt == null) {
        activeOutage = this.outages[index]
        break
      }
    }
    if (snapshot.overallStatus === 'offline' && !activeOutage) {
      const reason = snapshot.stages
        .filter((stage) => stage.status === 'offline')
        .map((stage) => `${stage.label} 응답 없음`)
        .join(', ')
      this.outages.push({ startedAt: snapshot.checkedAt, endedAt: null, durationMs: null, reason })
    } else if (snapshot.overallStatus !== 'offline' && activeOutage) {
      activeOutage.endedAt = snapshot.checkedAt
      activeOutage.durationMs = snapshot.checkedAt - activeOutage.startedAt
    }

    this.prune()
    if (!previous || changed || snapshot.checkedAt - this.lastPersistedSampleAt < 1000) this.persist()
  }

  private prune(): void {
    const cutoff = Date.now() - this.settings.retentionDays * 24 * 60 * 60 * 1000
    this.samples = this.samples.filter((sample) => sample.timestamp >= cutoff)
    this.outages = this.outages.filter((outage) => (outage.endedAt ?? Date.now()) >= cutoff)
  }

  private load(): void {
    try {
      const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8')) as PersistedNetworkData
      this.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) }
      this.samples = Array.isArray(data.samples) ? data.samples : []
      this.outages = Array.isArray(data.outages) ? data.outages : []
      this.lastWeeklyReportAt = data.lastWeeklyReportAt ?? null
      this.lastPersistedSampleAt = this.samples.at(-1)?.timestamp ?? 0
      this.prune()
    } catch {
      this.settings = { ...DEFAULT_SETTINGS }
    }
  }

  private persist(): void {
    if (!this.dataFile) return
    const data: PersistedNetworkData = {
      settings: this.settings,
      samples: this.samples,
      outages: this.outages,
      lastWeeklyReportAt: this.lastWeeklyReportAt,
    }
    try {
      fs.mkdirSync(path.dirname(this.dataFile), { recursive: true })
      fs.writeFileSync(this.dataFile, JSON.stringify(data), 'utf8')
    } catch {
      // Monitoring continues even when local history cannot be persisted.
    }
  }

  private async maybeWriteWeeklyReport(): Promise<void> {
    if (!this.settings.autoWeeklyReport || new Date().getDay() !== this.settings.reportWeekday) return
    if (this.lastWeeklyReportAt && Date.now() - this.lastWeeklyReportAt < 6 * 24 * 60 * 60 * 1000) return

    const folder = path.join(app.getPath('documents'), 'PC Management Assistant', 'Reports')
    const stamp = new Date().toISOString().slice(0, 10)
    fs.mkdirSync(folder, { recursive: true })
    const supplement = this.createWeeklySupplement?.().trim()
    const report = [this.createMarkdownReport(7), supplement].filter(Boolean).join('\n\n---\n\n')
    fs.writeFileSync(path.join(folder, `network-weekly-${stamp}.md`), report, 'utf8')
    this.lastWeeklyReportAt = Date.now()
    this.persist()
  }
}
