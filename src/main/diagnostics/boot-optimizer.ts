import { app } from 'electron'
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { runPowerShell } from '../utils/powershell'
import {
  BootHistoryEntry,
  BootOptimizationChange,
  BootOptimizationSnapshot,
  StartupItem,
  StartupItemType,
} from '../../shared/diagnostics'

interface RawBootEvent {
  Timestamp?: string
  BootTime?: number | string
  MainPathBootTime?: number | string
  BootPostBootTime?: number | string
}

interface RawStartupItem {
  Name?: string
  Type?: StartupItemType
  Location?: string
  EntryName?: string
  Command?: string
  Publisher?: string
  Enabled?: boolean
  RequiresAdmin?: boolean
}

interface RawDegradation {
  Timestamp?: string
  Name?: string
  Path?: string
  TotalTime?: number | string
  DegradationTime?: number | string
}

interface RawBootCollection {
  BootEvents?: RawBootEvent[] | RawBootEvent
  StartupItems?: RawStartupItem[] | RawStartupItem
  Degradations?: RawDegradation[] | RawDegradation
}

interface StoredChange extends BootOptimizationChange {
  item: StartupItem
}

interface PersistedBootData {
  changes: StoredChange[]
  restorePointAutoCreate: boolean
}

const PROTECTED_SERVICE_NAMES = new Set([
  'WinDefend', 'WdNisSvc', 'SecurityHealthService', 'RpcSs', 'DcomLaunch',
  'EventLog', 'PlugPlay', 'Power', 'ProfSvc', 'Schedule', 'SamSs', 'LanmanWorkstation',
])

function asArray<T>(value: T[] | T | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function psLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

function finiteMilliseconds(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function stableId(item: Pick<RawStartupItem, 'Type' | 'Location' | 'EntryName'>): string {
  return createHash('sha256')
    .update(`${item.Type ?? ''}\0${item.Location ?? ''}\0${item.EntryName ?? ''}`)
    .digest('hex')
    .slice(0, 20)
}

function normalizedText(value: string): string {
  return value.toLocaleLowerCase().replace(/["']/g, '').replace(/\\/g, '/')
}

function isMicrosoftItem(item: RawStartupItem): boolean {
  const text = `${item.Publisher ?? ''} ${item.Command ?? ''} ${item.Location ?? ''}`.toLocaleLowerCase()
  return text.includes('microsoft') || text.includes('\\windows\\system32') || text.includes('/windows/system32')
}

function canManageItem(item: RawStartupItem): boolean {
  if (!item.Type || !item.EntryName || !item.Location) return false
  if (item.Type === 'service') {
    return !PROTECTED_SERVICE_NAMES.has(item.EntryName) && !isMicrosoftItem(item)
  }
  if (item.Type === 'task') return !item.Location.toLocaleLowerCase().startsWith('\\microsoft\\')
  return true
}

export class BootOptimizerService {
  private snapshot: BootOptimizationSnapshot | null = null
  private changes: StoredChange[] = []
  private restorePointAutoCreate = true
  private restorePointCreatedThisSession = false
  private refreshing = false
  private dataFile = ''
  private onUpdate: ((snapshot: BootOptimizationSnapshot) => void) | null = null

  initialize(onUpdate: (snapshot: BootOptimizationSnapshot) => void): void {
    this.onUpdate = onUpdate
    this.dataFile = path.join(app.getPath('userData'), 'boot-optimizer.json')
    this.load()
    void this.refresh().catch(() => {})
  }

  getSnapshot(): BootOptimizationSnapshot | null {
    return this.snapshot
  }

  async refresh(): Promise<BootOptimizationSnapshot> {
    if (this.refreshing && this.snapshot) return this.snapshot
    this.refreshing = true
    try {
      const raw = await this.collect()
      const bootHistory = this.parseBootHistory(asArray(raw.BootEvents))
      const startupItems = this.parseStartupItems(asArray(raw.StartupItems), asArray(raw.Degradations))
      const latestBoot = bootHistory[0] ?? null
      const averageBootSeconds = bootHistory.length > 0
        ? bootHistory.reduce((sum, item) => sum + item.totalSeconds, 0) / bootHistory.length
        : null
      const previous = bootHistory.slice(1)
      const previousAverage = previous.length > 0
        ? previous.reduce((sum, item) => sum + item.totalSeconds, 0) / previous.length
        : null
      const improvementSeconds = latestBoot && previousAverage != null
        ? previousAverage - latestBoot.totalSeconds
        : null

      this.snapshot = {
        checkedAt: Date.now(),
        latestBoot,
        averageBootSeconds,
        improvementSeconds,
        bootHistory,
        startupItems,
        changes: this.publicChanges(),
        restorePointAutoCreate: this.restorePointAutoCreate,
      }
      this.onUpdate?.(this.snapshot)
      return this.snapshot
    } finally {
      this.refreshing = false
    }
  }

  setRestorePointAutoCreate(enabled: boolean): BootOptimizationSnapshot | null {
    this.restorePointAutoCreate = !!enabled
    this.persist()
    if (this.snapshot) {
      this.snapshot = { ...this.snapshot, restorePointAutoCreate: this.restorePointAutoCreate }
      this.onUpdate?.(this.snapshot)
    }
    return this.snapshot
  }

  async createRestorePoint(): Promise<void> {
    const description = `PC Management Assistant ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
    const script = `
$ErrorActionPreference = 'Stop'
Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction SilentlyContinue
Checkpoint-Computer -Description ${psLiteral(description)} -RestorePointType 'MODIFY_SETTINGS'
`
    await runPowerShell(script, 120_000)
    this.restorePointCreatedThisSession = true
  }

  async disableItem(itemId: string): Promise<BootOptimizationSnapshot> {
    const item = this.snapshot?.startupItems.find((candidate) => candidate.id === itemId)
    if (!item) throw new Error('시작 항목을 찾을 수 없습니다. 새로 고침 후 다시 시도해주세요.')
    if (!item.manageable) throw new Error('Windows 핵심 항목 또는 안전하게 관리할 수 없는 항목입니다.')
    if (!item.enabled) throw new Error('이미 꺼진 항목입니다.')

    if (this.restorePointAutoCreate && !this.restorePointCreatedThisSession) {
      try {
        await this.createRestorePoint()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`복원 지점을 만들지 못해 변경을 중단했습니다. 관리자 권한과 시스템 보호 설정을 확인해주세요. (${message})`)
      }
    }

    await this.applyDisable(item)
    this.changes.push({
      id: `change-${Date.now()}-${item.id}`,
      itemId: item.id,
      itemName: item.name,
      action: 'disabled',
      changedAt: Date.now(),
      restoredAt: null,
      item: { ...item },
    })
    this.persist()
    return await this.refresh()
  }

  async restoreChange(changeId: string): Promise<BootOptimizationSnapshot> {
    const change = this.changes.find((candidate) => candidate.id === changeId && candidate.restoredAt == null)
    if (!change) throw new Error('되돌릴 변경 기록을 찾을 수 없습니다.')
    await this.applyRestore(change.item)
    change.restoredAt = Date.now()
    this.persist()
    return await this.refresh()
  }

  async restoreAll(): Promise<BootOptimizationSnapshot> {
    const active = this.changes.filter((change) => change.restoredAt == null).reverse()
    const errors: string[] = []
    for (const change of active) {
      try {
        await this.applyRestore(change.item)
        change.restoredAt = Date.now()
      } catch (error) {
        errors.push(`${change.itemName}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.persist()
    const snapshot = await this.refresh()
    if (errors.length > 0) throw new Error(`일부 항목을 되돌리지 못했습니다. ${errors.join(' / ')}`)
    return snapshot
  }

  createMarkdownReport(): string {
    const snapshot = this.snapshot
    const lines = [
      '# PC Management Assistant 부팅 최적화 리포트',
      '',
      `- 생성 시각: ${new Date().toLocaleString('ko-KR')}`,
      `- 최근 부팅: ${snapshot?.latestBoot ? `${snapshot.latestBoot.totalSeconds.toFixed(1)}초` : '측정 기록 없음'}`,
      `- 로그인까지: ${snapshot?.latestBoot ? `${snapshot.latestBoot.loginSeconds.toFixed(1)}초` : '-'}`,
      `- 로그인 이후: ${snapshot?.latestBoot ? `${snapshot.latestBoot.postLoginSeconds.toFixed(1)}초` : '-'}`,
      `- 평균 부팅: ${snapshot?.averageBootSeconds == null ? '-' : `${snapshot.averageBootSeconds.toFixed(1)}초`}`,
      '',
      '## 실측 시작 항목',
      '',
      '| 이름 | 유형 | 최근 지연 | 평균 지연 | 측정 횟수 | 상태 |',
      '|---|---|---:|---:|---:|---|',
    ]

    for (const item of snapshot?.startupItems.filter((candidate) => candidate.measuredDelaySeconds != null) ?? []) {
      lines.push(`| ${item.name} | ${item.type} | ${item.measuredDelaySeconds?.toFixed(2)}초 | ${item.averageDelaySeconds?.toFixed(2)}초 | ${item.measuredCount} | ${item.enabled ? '켜짐' : '꺼짐'} |`)
    }

    lines.push('', '## 변경 기록', '')
    const changes = snapshot?.changes ?? []
    if (changes.length === 0) {
      lines.push('아직 변경한 항목이 없습니다.')
    } else {
      for (const change of changes) {
        lines.push(`- ${new Date(change.changedAt).toLocaleString('ko-KR')} · ${change.itemName} 끄기${change.restoredAt ? ` · ${new Date(change.restoredAt).toLocaleString('ko-KR')} 되돌림` : ''}`)
      }
    }
    lines.push('')
    return lines.join('\n')
  }

  private publicChanges(): BootOptimizationChange[] {
    return this.changes.map(({ item: _item, ...change }) => ({ ...change }))
  }

  private parseBootHistory(events: RawBootEvent[]): BootHistoryEntry[] {
    return events.flatMap((event) => {
      const total = finiteMilliseconds(event.BootTime)
      const login = finiteMilliseconds(event.MainPathBootTime)
      const post = finiteMilliseconds(event.BootPostBootTime)
      const timestamp = new Date(event.Timestamp ?? '').getTime()
      if (total == null || !Number.isFinite(timestamp)) return []
      return [{
        timestamp,
        totalSeconds: total / 1000,
        loginSeconds: (login ?? total) / 1000,
        postLoginSeconds: (post ?? Math.max(0, total - (login ?? 0))) / 1000,
      }]
    }).sort((a, b) => b.timestamp - a.timestamp)
  }

  private parseStartupItems(items: RawStartupItem[], degradations: RawDegradation[]): StartupItem[] {
    return items
      .filter((item): item is RawStartupItem & { Type: StartupItemType; Location: string; EntryName: string } =>
        !!item.Type && !!item.Location && !!item.EntryName)
      .map((item) => {
        const searchable = normalizedText(`${item.Name ?? ''} ${item.EntryName} ${item.Command ?? ''}`)
        const matches = degradations.filter((event) => {
          const eventText = normalizedText(`${event.Name ?? ''} ${event.Path ?? ''}`)
          if (!eventText) return false
          const tokens = eventText.split(/[\s/]+/).filter((token) => token.length >= 4)
          return tokens.some((token) => searchable.includes(token))
        })
        const delays = matches.flatMap((event) => {
          const total = finiteMilliseconds(event.TotalTime)
          const degradation = finiteMilliseconds(event.DegradationTime)
          const value = degradation ?? total
          return value == null ? [] : [value / 1000]
        })
        const latest = matches
          .map((event, index) => ({ index, timestamp: new Date(event.Timestamp ?? '').getTime() }))
          .sort((a, b) => b.timestamp - a.timestamp)[0]
        const latestDelay = latest == null ? null : delays[latest.index] ?? delays[0] ?? null
        const averageDelay = delays.length > 0 ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null
        const impact = latestDelay == null ? 'unknown' : latestDelay >= 5 ? 'high' : latestDelay >= 2 ? 'medium' : 'low'

        return {
          id: stableId(item),
          name: item.Name || item.EntryName,
          type: item.Type,
          location: item.Location,
          entryName: item.EntryName,
          command: item.Command || '',
          publisher: item.Publisher || '',
          enabled: item.Enabled !== false,
          requiresAdmin: item.RequiresAdmin === true,
          manageable: canManageItem(item),
          measuredDelaySeconds: latestDelay,
          averageDelaySeconds: averageDelay,
          measuredCount: delays.length,
          impact,
        } satisfies StartupItem
      })
      .sort((a, b) => (b.measuredDelaySeconds ?? -1) - (a.measuredDelaySeconds ?? -1))
  }

  private async collect(): Promise<RawBootCollection> {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
function Get-EventFields($event) {
  $fields = @{}
  try {
    [xml]$xml = $event.ToXml()
    foreach ($data in $xml.Event.EventData.Data) {
      if ($data.Name) { $fields[[string]$data.Name] = [string]$data.'#text' }
    }
  } catch {}
  return $fields
}

$logName = 'Microsoft-Windows-Diagnostics-Performance/Operational'
$bootEvents = @(
  Get-WinEvent -FilterHashtable @{ LogName = $logName; Id = 100 } -MaxEvents 12 |
    ForEach-Object {
      $f = Get-EventFields $_
      [PSCustomObject]@{
        Timestamp = $_.TimeCreated.ToString('o')
        BootTime = $f['BootTime']
        MainPathBootTime = $f['MainPathBootTime']
        BootPostBootTime = $f['BootPostBootTime']
      }
    }
)

$degradations = @(
  Get-WinEvent -FilterHashtable @{ LogName = $logName; Id = 101,102,103,106,107,108,109,110 } -MaxEvents 200 |
    ForEach-Object {
      $f = Get-EventFields $_
      [PSCustomObject]@{
        Timestamp = $_.TimeCreated.ToString('o')
        Name = if ($f['FriendlyName']) { $f['FriendlyName'] } else { $f['Name'] }
        Path = $f['Path']
        TotalTime = $f['TotalTime']
        DegradationTime = $f['DegradationTime']
      }
    }
)

$items = @()
foreach ($spec in @(
  @{ Path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; Admin = $false },
  @{ Path = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; Admin = $true },
  @{ Path = 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; Admin = $true }
)) {
  if (Test-Path $spec.Path) {
    $properties = (Get-ItemProperty -Path $spec.Path).PSObject.Properties |
      Where-Object { $_.Name -notmatch '^PS(Path|ParentPath|ChildName|Drive|Provider)$' }
    foreach ($property in $properties) {
      $items += [PSCustomObject]@{
        Name = [string]$property.Name
        Type = 'registry'
        Location = [string]$spec.Path
        EntryName = [string]$property.Name
        Command = [string]$property.Value
        Publisher = ''
        Enabled = $true
        RequiresAdmin = [bool]$spec.Admin
      }
    }
  }
}

foreach ($folder in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
  if ($folder -and (Test-Path $folder)) {
    Get-ChildItem -LiteralPath $folder -File | ForEach-Object {
      $disabled = $_.Name.EndsWith('.pcma-disabled')
      $items += [PSCustomObject]@{
        Name = if ($disabled) { $_.Name.Substring(0, $_.Name.Length - 14) } else { $_.BaseName }
        Type = 'startup'
        Location = $_.FullName
        EntryName = $_.Name
        Command = $_.FullName
        Publisher = ''
        Enabled = -not $disabled
        RequiresAdmin = $folder -eq [Environment]::GetFolderPath('CommonStartup')
      }
    }
  }
}

Get-ScheduledTask | ForEach-Object {
  $task = $_
  $isStartup = @($task.Triggers | Where-Object {
    $_.CimClass.CimClassName -in 'MSFT_TaskLogonTrigger','MSFT_TaskBootTrigger'
  }).Count -gt 0
  if ($isStartup) {
    $command = @($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join '; '
    $items += [PSCustomObject]@{
      Name = $task.TaskName
      Type = 'task'
      Location = $task.TaskPath
      EntryName = $task.TaskName
      Command = $command.Trim()
      Publisher = ''
      Enabled = $task.State -ne 'Disabled'
      RequiresAdmin = $true
    }
  }
}

Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' } | ForEach-Object {
  $publisher = ''
  try {
    $exePath = [regex]::Match($_.PathName, '^\"?([^\"]+?\\.exe)').Groups[1].Value
    if ($exePath -and (Test-Path $exePath)) { $publisher = (Get-Item $exePath).VersionInfo.CompanyName }
  } catch {}
  $items += [PSCustomObject]@{
    Name = $_.DisplayName
    Type = 'service'
    Location = $_.Name
    EntryName = $_.Name
    Command = $_.PathName
    Publisher = $publisher
    Enabled = $true
    RequiresAdmin = $true
  }
}

[PSCustomObject]@{
  BootEvents = @($bootEvents)
  StartupItems = @($items)
  Degradations = @($degradations)
} | ConvertTo-Json -Depth 6 -Compress
`
    const output = await runPowerShell(script, 45_000)
    return JSON.parse(output) as RawBootCollection
  }

  private async applyDisable(item: StartupItem): Promise<void> {
    let script = ''
    if (item.type === 'registry') {
      script = `Remove-ItemProperty -LiteralPath ${psLiteral(item.location)} -Name ${psLiteral(item.entryName)} -ErrorAction Stop`
    } else if (item.type === 'startup') {
      script = `$source = ${psLiteral(item.location)}; Rename-Item -LiteralPath $source -NewName ((Split-Path $source -Leaf) + '.pcma-disabled') -ErrorAction Stop`
    } else if (item.type === 'task') {
      script = `Disable-ScheduledTask -TaskPath ${psLiteral(item.location)} -TaskName ${psLiteral(item.entryName)} -ErrorAction Stop | Out-Null`
    } else {
      script = `Set-Service -Name ${psLiteral(item.entryName)} -StartupType Manual -ErrorAction Stop`
    }
    await runPowerShell(`$ErrorActionPreference = 'Stop'\n${script}`, 30_000)
  }

  private async applyRestore(item: StartupItem): Promise<void> {
    let script = ''
    if (item.type === 'registry') {
      script = `New-ItemProperty -LiteralPath ${psLiteral(item.location)} -Name ${psLiteral(item.entryName)} -Value ${psLiteral(item.command)} -PropertyType String -Force -ErrorAction Stop | Out-Null`
    } else if (item.type === 'startup') {
      script = `$source = ${psLiteral(`${item.location}.pcma-disabled`)}; Rename-Item -LiteralPath $source -NewName ${psLiteral(path.basename(item.location))} -ErrorAction Stop`
    } else if (item.type === 'task') {
      script = `Enable-ScheduledTask -TaskPath ${psLiteral(item.location)} -TaskName ${psLiteral(item.entryName)} -ErrorAction Stop | Out-Null`
    } else {
      script = `Set-Service -Name ${psLiteral(item.entryName)} -StartupType Automatic -ErrorAction Stop`
    }
    await runPowerShell(`$ErrorActionPreference = 'Stop'\n${script}`, 30_000)
  }

  private load(): void {
    try {
      const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8')) as PersistedBootData
      this.changes = Array.isArray(data.changes) ? data.changes : []
      this.restorePointAutoCreate = data.restorePointAutoCreate !== false
    } catch {
      this.changes = []
      this.restorePointAutoCreate = true
    }
  }

  private persist(): void {
    if (!this.dataFile) return
    try {
      fs.mkdirSync(path.dirname(this.dataFile), { recursive: true })
      fs.writeFileSync(this.dataFile, JSON.stringify({
        changes: this.changes,
        restorePointAutoCreate: this.restorePointAutoCreate,
      } satisfies PersistedBootData), 'utf8')
    } catch {
      // The app keeps the current session state even if local persistence fails.
    }
  }
}
