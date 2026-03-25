$ErrorActionPreference = 'SilentlyContinue'

$matches = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*infra\\https-proxy.js*' }

foreach ($proc in $matches) {
  Stop-Process -Id $proc.ProcessId -Force
}
