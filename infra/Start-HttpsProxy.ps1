$ErrorActionPreference = 'Stop'

$root = 'C:\Users\doyoon\Desktop\PC Management Assistant'
$nodeScript = Join-Path $root 'infra\https-proxy.js'
$stdout = Join-Path $root 'infra\proxy.out.log'
$stderr = Join-Path $root 'infra\proxy.err.log'

Start-Process `
  -FilePath node `
  -ArgumentList @('infra\https-proxy.js') `
  -WorkingDirectory $root `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -WindowStyle Hidden
