param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$serverRoot = Split-Path -Parent $PSScriptRoot

Push-Location $serverRoot
try {
  if (-not $SkipBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "Build failed with exit code $LASTEXITCODE."
    }
  }

  node dist/index.js
} finally {
  Pop-Location
}
