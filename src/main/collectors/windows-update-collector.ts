import { runPowerShell } from '../utils/powershell'

export interface WindowsUpdateInfo {
  Title: string
  Severity: string
}

export interface WindowsUpdateResult {
  count: number        // -1 = 오류/알 수 없음
  updates: WindowsUpdateInfo[]
  error?: string
  checkedAt: number
  isChecking: boolean
}

const CHECK_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $result = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0")
  $updates = @($result.Updates | ForEach-Object {
    [PSCustomObject]@{
      Title    = $_.Title
      Severity = if ($_.MsrcSeverity) { $_.MsrcSeverity } else { 'Unspecified' }
    }
  })
  [PSCustomObject]@{
    Count   = $result.Updates.Count
    Updates = $updates
  } | ConvertTo-Json -Compress -Depth 3
} catch {
  [PSCustomObject]@{
    Count = -1
    Error = $_.Exception.Message
    Updates = @()
  } | ConvertTo-Json -Compress
}
`

export class WindowsUpdateCollector {
  private lastResult: WindowsUpdateResult = {
    count: -1,
    updates: [],
    checkedAt: 0,
    isChecking: false,
  }
  private readonly POLL_INTERVAL = 30 * 60 * 1000  // 30분

  async collect(force = false): Promise<WindowsUpdateResult> {
    const now = Date.now()
    if (!force && now - this.lastResult.checkedAt < this.POLL_INTERVAL) {
      return this.lastResult
    }
    // force=false일 때만 중복 실행 방지 (force=true는 항상 실행)
    if (!force && this.lastResult.isChecking) {
      return this.lastResult
    }

    this.lastResult = { ...this.lastResult, isChecking: true }

    try {
      const raw = await runPowerShell(CHECK_SCRIPT, 90000)
      const parsed = JSON.parse(raw) as {
        Count: number
        Updates?: { Title: string; Severity: string }[]
        Error?: string
      }

      this.lastResult = {
        count: parsed.Count ?? -1,
        updates: (parsed.Updates ?? []).map((u) => ({
          Title: u.Title,
          Severity: u.Severity ?? 'Unspecified',
        })),
        error: parsed.Error,
        checkedAt: Date.now(),
        isChecking: false,
      }
    } catch (err) {
      this.lastResult = {
        count: -1,
        updates: [],
        error: err instanceof Error ? err.message : String(err),
        checkedAt: Date.now(),
        isChecking: false,
      }
    }

    return this.lastResult
  }

  getLastResult(): WindowsUpdateResult {
    return this.lastResult
  }
}
