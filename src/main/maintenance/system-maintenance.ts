import { runPowerShell } from '../utils/powershell'

export type MaintenanceStepStatus = 'success' | 'warning' | 'error'

export interface SystemMaintenanceStep {
  key: 'memory' | 'startup' | 'disk' | 'network' | 'dcom' | 'windowsUpdate'
  title: string
  status: MaintenanceStepStatus
  detail: string
}

export interface SystemMaintenanceReport {
  startedAt: number
  finishedAt: number
  steps: SystemMaintenanceStep[]
  summary: string
}

interface MemoryOptimizeResult {
  CandidateCount?: number
  Closed?: unknown
  Failed?: unknown
}

interface StartupManageResult {
  Disabled?: unknown
  RemainingEnabled?: number
}

interface DiskCleanupDriveResult {
  Drive?: string
  Exists?: boolean
  DeletedFiles?: number
  DeletedMB?: number
  Cleanmgr?: boolean
}

interface NetworkCheckResult {
  Gateway?: string
  PingGateway?: boolean
  PingInternet?: boolean
  Adapters?: unknown
  RouterRebootRequired?: boolean
}

interface DcomCheckResult {
  Count?: number
  Services?: Array<{ Name?: string; Status?: string; StartType?: string }>
}

interface WindowsUpdateInstallResult {
  PendingCount?: number
  InstalledCount?: number
  RebootRequired?: boolean
  ResultCode?: number
}

const MEMORY_OPT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$exclude = @(
  'System','Idle','Registry','smss','csrss','wininit','services','lsass',
  'svchost','winlogon','explorer','SearchIndexer','SecurityHealthService',
  'PC Management Assistant'
)
$targets = Get-Process | Where-Object {
  $_.WorkingSet64 -gt 300MB -and
  $_.ProcessName -notin $exclude -and
  $_.Id -ne $PID
} | Sort-Object WorkingSet64 -Descending | Select-Object -First 5

$closed = @()
$failed = @()
foreach ($p in $targets) {
  try {
    Stop-Process -Id $p.Id -Force -ErrorAction Stop
    $closed += "$($p.ProcessName)($($p.Id))"
  } catch {
    $failed += "$($p.ProcessName)($($p.Id))"
  }
}

[PSCustomObject]@{
  CandidateCount = $targets.Count
  Closed = $closed
  Failed = $failed
} | ConvertTo-Json -Compress
`

const STARTUP_MANAGE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$runPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
$backupPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run-Disabled-PCAssistant'
$patterns = @('update','helper','launcher','discord','teams','spotify','steam')

if (!(Test-Path $backupPath)) {
  New-Item -Path $backupPath -Force | Out-Null
}

$disabled = @()
if (Test-Path $runPath) {
  $props = (Get-ItemProperty -Path $runPath).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' }
  foreach ($prop in $props) {
    $txt = ($prop.Name + ' ' + [string]$prop.Value).ToLower()
    $matched = $false
    foreach ($pattern in $patterns) {
      if ($txt.Contains($pattern)) { $matched = $true; break }
    }
    if ($matched) {
      New-ItemProperty -Path $backupPath -Name $prop.Name -PropertyType String -Value ([string]$prop.Value) -Force | Out-Null
      Remove-ItemProperty -Path $runPath -Name $prop.Name -ErrorAction SilentlyContinue
      $disabled += $prop.Name
    }
  }
}

$remaining = 0
if (Test-Path $runPath) {
  $remaining = ((Get-ItemProperty -Path $runPath).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' }).Count
}

[PSCustomObject]@{
  Disabled = $disabled
  RemainingEnabled = $remaining
} | ConvertTo-Json -Compress
`

const DISK_CLEANUP_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$drives = @('E','F')
$results = @()

foreach ($d in $drives) {
  $root = ('{0}:\\' -f $d)
  if (!(Test-Path $root)) {
    $results += [PSCustomObject]@{
      Drive = $d
      Exists = $false
      DeletedFiles = 0
      DeletedMB = 0
      Cleanmgr = $false
    }
    continue
  }

  $deletedCount = 0
  $deletedBytes = 0
  $targets = @("$root\\Temp", "$root\\Downloads", "$root\\Download")

  foreach ($folder in $targets) {
    if (Test-Path $folder) {
      Get-ChildItem -Path $folder -Recurse -File -Include *.tmp,*.log,*.bak -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-3) } |
        ForEach-Object {
          $deletedBytes += $_.Length
          Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
          $deletedCount += 1
        }
    }
  }

  try { Clear-RecycleBin -DriveLetter $d -Force -ErrorAction SilentlyContinue | Out-Null } catch {}

  $cleanMgrRan = $false
  try {
    Start-Process -FilePath cleanmgr.exe -ArgumentList "/VERYLOWDISK /D $d" -WindowStyle Hidden -Wait
    $cleanMgrRan = $true
  } catch {}

  $results += [PSCustomObject]@{
    Drive = $d
    Exists = $true
    DeletedFiles = $deletedCount
    DeletedMB = [math]::Round($deletedBytes / 1MB, 2)
    Cleanmgr = $cleanMgrRan
  }
}

$results | ConvertTo-Json -Compress
`

const NETWORK_CHECK_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } |
  Select-Object Name, InterfaceDescription, LinkSpeed, DriverVersion
$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop
$pingGateway = if ($gw) { Test-Connection -ComputerName $gw -Count 2 -Quiet } else { $false }
$pingInternet = Test-Connection -ComputerName '8.8.8.8' -Count 2 -Quiet

[PSCustomObject]@{
  Gateway = $gw
  PingGateway = $pingGateway
  PingInternet = $pingInternet
  Adapters = $adapters
  RouterRebootRequired = (-not $pingGateway -or -not $pingInternet)
} | ConvertTo-Json -Compress -Depth 4
`

const DCOM_CHECK_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$events = Get-WinEvent -FilterHashtable @{
  LogName = 'System'
  ProviderName = 'Microsoft-Windows-DistributedCOM'
  Id = 10016
  StartTime = (Get-Date).AddHours(-24)
} -ErrorAction SilentlyContinue | Select-Object -First 20 TimeCreated, Id, Message

$dcomService = Get-Service -Name DcomLaunch -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType
$rpcService = Get-Service -Name RpcSs -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType

[PSCustomObject]@{
  Count = @($events).Count
  Services = @($dcomService, $rpcService)
} | ConvertTo-Json -Compress -Depth 4
`

const WINDOWS_UPDATE_APPLY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $result = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0")

  if ($result.Updates.Count -eq 0) {
    [PSCustomObject]@{
      PendingCount = 0
      InstalledCount = 0
      RebootRequired = $false
      ResultCode = 0
    } | ConvertTo-Json -Compress
    return
  }

  $updates = New-Object -ComObject Microsoft.Update.UpdateColl
  foreach ($u in $result.Updates) {
    if (-not $u.EulaAccepted) { $u.AcceptEula() }
    [void]$updates.Add($u)
  }

  $downloader = $session.CreateUpdateDownloader()
  $downloader.Updates = $updates
  [void]$downloader.Download()

  $installer = $session.CreateUpdateInstaller()
  $installer.Updates = $updates
  $installResult = $installer.Install()

  $installedCount = 0
  for ($i = 0; $i -lt $updates.Count; $i++) {
    if ($installResult.GetUpdateResult($i).ResultCode -eq 2) { $installedCount += 1 }
  }

  [PSCustomObject]@{
    PendingCount = $result.Updates.Count
    InstalledCount = $installedCount
    RebootRequired = $installResult.RebootRequired
    ResultCode = [int]$installResult.ResultCode
  } | ConvertTo-Json -Compress
} catch {
  [PSCustomObject]@{
    PendingCount = -1
    InstalledCount = 0
    RebootRequired = $false
    ResultCode = -1
  } | ConvertTo-Json -Compress
}
`

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v))
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function extractJson(raw: string): string {
  const text = raw.trim()
  if (!text) throw new Error('Empty PowerShell output')
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    return text
  }

  const idxObj = text.indexOf('{')
  const idxArr = text.indexOf('[')
  const hasObj = idxObj >= 0
  const hasArr = idxArr >= 0

  let start = -1
  if (hasObj && hasArr) start = Math.min(idxObj, idxArr)
  else if (hasObj) start = idxObj
  else if (hasArr) start = idxArr

  if (start < 0) throw new Error(`No JSON found in output: ${text}`)

  const endObj = text.lastIndexOf('}')
  const endArr = text.lastIndexOf(']')
  const end = Math.max(endObj, endArr)
  if (end < start) throw new Error(`Invalid JSON output: ${text}`)

  return text.slice(start, end + 1)
}

async function runJsonScript<T>(script: string, timeoutMs: number): Promise<T> {
  const raw = await runPowerShell(script, timeoutMs)
  return JSON.parse(extractJson(raw)) as T
}

export class SystemMaintenanceService {
  private lastReport: SystemMaintenanceReport | null = null
  private autoUpdateRunning = false

  getLastReport(): SystemMaintenanceReport | null {
    return this.lastReport
  }

  async runFullMaintenance(): Promise<SystemMaintenanceReport> {
    const startedAt = Date.now()
    const steps: SystemMaintenanceStep[] = []

    steps.push(await this.optimizeMemory())
    steps.push(await this.manageStartup())
    steps.push(await this.cleanupDisks())
    steps.push(await this.checkNetwork())
    steps.push(await this.checkDcom())
    steps.push(await this.applyWindowsUpdates('manual'))

    const finishedAt = Date.now()
    const successCount = steps.filter((s) => s.status === 'success').length
    const warningCount = steps.filter((s) => s.status === 'warning').length
    const errorCount = steps.filter((s) => s.status === 'error').length
    const summary = `완료: 성공 ${successCount}, 경고 ${warningCount}, 오류 ${errorCount}`

    const report: SystemMaintenanceReport = {
      startedAt,
      finishedAt,
      steps,
      summary,
    }
    this.lastReport = report
    return report
  }

  async runAutoWindowsUpdateApply(): Promise<SystemMaintenanceStep | null> {
    if (this.autoUpdateRunning) return null
    this.autoUpdateRunning = true
    try {
      return await this.applyWindowsUpdates('auto')
    } finally {
      this.autoUpdateRunning = false
    }
  }

  private async optimizeMemory(): Promise<SystemMaintenanceStep> {
    try {
      const data = await runJsonScript<MemoryOptimizeResult>(MEMORY_OPT_SCRIPT, 60000)
      const closed = normalizeStringArray(data.Closed)
      const failed = normalizeStringArray(data.Failed)
      const candidates = data.CandidateCount ?? 0

      if (closed.length > 0) {
        return {
          key: 'memory',
          title: '메모리 최적화',
          status: failed.length > 0 ? 'warning' : 'success',
          detail: `후보 ${candidates}개 중 ${closed.length}개 종료, 실패 ${failed.length}개`,
        }
      }

      return {
        key: 'memory',
        title: '메모리 최적화',
        status: 'warning',
        detail: candidates > 0 ? '종료 가능한 프로세스가 없거나 종료 실패' : '종료 대상 프로세스 없음',
      }
    } catch (err) {
      return {
        key: 'memory',
        title: '메모리 최적화',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async manageStartup(): Promise<SystemMaintenanceStep> {
    try {
      const data = await runJsonScript<StartupManageResult>(STARTUP_MANAGE_SCRIPT, 45000)
      const disabled = normalizeStringArray(data.Disabled)
      const remaining = data.RemainingEnabled ?? 0
      return {
        key: 'startup',
        title: '자동 시작 프로그램 관리',
        status: disabled.length > 0 ? 'success' : 'warning',
        detail: `비활성화 ${disabled.length}개, 현재 활성 항목 ${remaining}개`,
      }
    } catch (err) {
      return {
        key: 'startup',
        title: '자동 시작 프로그램 관리',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async cleanupDisks(): Promise<SystemMaintenanceStep> {
    try {
      const data = await runJsonScript<DiskCleanupDriveResult[] | DiskCleanupDriveResult>(DISK_CLEANUP_SCRIPT, 240000)
      const rows = ensureArray(data)
      const existing = rows.filter((r) => r.Exists)
      const deletedFiles = existing.reduce((acc, row) => acc + (row.DeletedFiles ?? 0), 0)
      const deletedMb = existing.reduce((acc, row) => acc + (row.DeletedMB ?? 0), 0)
      const ranCleanmgr = existing.some((r) => r.Cleanmgr)

      if (existing.length === 0) {
        return {
          key: 'disk',
          title: '디스크 정리 (E/F)',
          status: 'warning',
          detail: 'E/F 드라이브를 찾지 못했습니다.',
        }
      }

      return {
        key: 'disk',
        title: '디스크 정리 (E/F)',
        status: 'success',
        detail: `삭제 파일 ${deletedFiles}개, 약 ${deletedMb.toFixed(1)}MB 정리, cleanmgr 실행 ${ranCleanmgr ? '완료' : '실패'}`,
      }
    } catch (err) {
      return {
        key: 'disk',
        title: '디스크 정리 (E/F)',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async checkNetwork(): Promise<SystemMaintenanceStep> {
    try {
      const data = await runJsonScript<NetworkCheckResult>(NETWORK_CHECK_SCRIPT, 45000)
      const adapters = ensureArray(data.Adapters as Array<{ Name?: string }> | { Name?: string } | null | undefined)
      const healthy = !!data.PingGateway && !!data.PingInternet
      const manual = data.RouterRebootRequired ? '라우터 재부팅 권장' : '라우터 상태 정상'
      return {
        key: 'network',
        title: '네트워크 점검',
        status: healthy ? 'success' : 'warning',
        detail: `어댑터 ${adapters.length}개 연결, 게이트웨이 ${data.PingGateway ? '정상' : '실패'}, 인터넷 ${data.PingInternet ? '정상' : '실패'} (${manual})`,
      }
    } catch (err) {
      return {
        key: 'network',
        title: '네트워크 점검',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async checkDcom(): Promise<SystemMaintenanceStep> {
    try {
      const data = await runJsonScript<DcomCheckResult>(DCOM_CHECK_SCRIPT, 45000)
      const count = data.Count ?? 0
      const services = ensureArray(data.Services)
      const badServices = services.filter((s) => s.Status !== 'Running')
      return {
        key: 'dcom',
        title: '이벤트 로그(DCOM) 점검',
        status: count === 0 && badServices.length === 0 ? 'success' : 'warning',
        detail: `최근 24시간 DCOM 오류 ${count}건, 서비스 비정상 ${badServices.length}개`,
      }
    } catch (err) {
      return {
        key: 'dcom',
        title: '이벤트 로그(DCOM) 점검',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async applyWindowsUpdates(mode: 'manual' | 'auto'): Promise<SystemMaintenanceStep> {
    try {
      const data = await runJsonScript<WindowsUpdateInstallResult>(WINDOWS_UPDATE_APPLY_SCRIPT, 480000)
      const pending = data.PendingCount ?? 0
      const installed = data.InstalledCount ?? 0
      const reboot = !!data.RebootRequired
      const code = data.ResultCode ?? 0

      if (pending < 0 || code < 0) {
        return {
          key: 'windowsUpdate',
          title: 'Windows Update 확인/적용',
          status: 'error',
          detail: `${mode === 'auto' ? '자동' : '수동'} 업데이트 적용 실패`,
        }
      }

      if (pending === 0) {
        return {
          key: 'windowsUpdate',
          title: 'Windows Update 확인/적용',
          status: 'success',
          detail: '적용할 업데이트가 없습니다.',
        }
      }

      const prefix = mode === 'auto' ? '자동 적용' : '적용'
      return {
        key: 'windowsUpdate',
        title: 'Windows Update 확인/적용',
        status: installed > 0 ? 'success' : 'warning',
        detail: `${prefix}: 대기 ${pending}개 중 설치 ${installed}개${reboot ? ' (재부팅 필요)' : ''}`,
      }
    } catch (err) {
      return {
        key: 'windowsUpdate',
        title: 'Windows Update 확인/적용',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
