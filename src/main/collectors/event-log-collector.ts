import { runPowerShell } from '../utils/powershell'

export interface WindowsEvent {
  TimeCreated: string
  Id: number
  LevelDisplayName: string
  ProviderName: string
  Message: string
}

export interface EventLogResult {
  events: WindowsEvent[]
  error?: string
  hasSecurityLog: boolean
}

const GET_EVENTS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$results = @()

# System + Application 로그 (일반 사용자 접근 가능)
try {
  $events = Get-WinEvent -FilterHashtable @{
    LogName='System','Application'
    Level=1,2,3
    StartTime=(Get-Date).AddHours(-24)
  } -MaxEvents 50 -ErrorAction SilentlyContinue

  if ($events) {
    $results += $events | Select-Object @{N='TimeCreated';E={$_.TimeCreated.ToString('o')}}, Id, LevelDisplayName, ProviderName, @{N='Message';E={$_.Message -replace '\\s+', ' ' | Select-Object -First 1}}
  }
} catch {}

$results | ConvertTo-Json -Compress -Depth 3
`

const CHECK_SECURITY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
try {
  $ev = Get-WinEvent -LogName Security -MaxEvents 1 -ErrorAction Stop
  Write-Output 'true'
} catch {
  Write-Output 'false'
}
`

export class EventLogCollector {
  private lastResult: EventLogResult = { events: [], hasSecurityLog: false }
  private lastCollectedAt = 0
  private readonly POLL_INTERVAL = 60_000 // 60초

  async collect(force = false): Promise<EventLogResult> {
    const now = Date.now()
    if (!force && now - this.lastCollectedAt < this.POLL_INTERVAL) {
      return this.lastResult
    }

    try {
      const [eventsJson, securityCheck] = await Promise.allSettled([
        runPowerShell(GET_EVENTS_SCRIPT, 20000),
        runPowerShell(CHECK_SECURITY_SCRIPT, 5000),
      ])

      let events: WindowsEvent[] = []
      let error: string | undefined

      if (eventsJson.status === 'fulfilled' && eventsJson.value) {
        try {
          const parsed = JSON.parse(eventsJson.value)
          events = Array.isArray(parsed) ? parsed : [parsed]
        } catch {
          events = []
        }
      } else if (eventsJson.status === 'rejected') {
        error = 'Windows 이벤트 로그 수집 실패'
      }

      const hasSecurityLog =
        securityCheck.status === 'fulfilled' && securityCheck.value.trim() === 'true'

      this.lastResult = { events, error, hasSecurityLog }
      this.lastCollectedAt = now
    } catch (err) {
      this.lastResult = {
        events: [],
        error: `이벤트 로그 수집 오류: ${err instanceof Error ? err.message : String(err)}`,
        hasSecurityLog: false,
      }
    }

    return this.lastResult
  }

  getLastResult(): EventLogResult {
    return this.lastResult
  }
}
