# DeepSeek Harness Windows CLI installer.
# Installs the `dsh` command (the interactive terminal client) for x64 or ARM64 Windows.

param(
  [Parameter(Position = 0)]
  [string]$Target = ''
)

$ErrorActionPreference = 'Stop'

$Repository = if ($env:DEEPSEEK_HARNESS_REPOSITORY) { $env:DEEPSEEK_HARNESS_REPOSITORY } else { 'srwang0506/deepseek-harness' }
$ReleaseBase = if ($env:DEEPSEEK_HARNESS_RELEASE_BASE) { $env:DEEPSEEK_HARNESS_RELEASE_BASE } else { "https://github.com/$Repository/releases/latest/download" }

function Fail([string]$Message) {
  Write-Host "DeepSeek Harness installer: $Message" -ForegroundColor Red
  exit 1
}

function Usage {
  Write-Host 'Usage: install.ps1 <target>'
  Write-Host ''
  Write-Host 'Targets:'
  Write-Host '  windows-x64    DeepSeek Harness CLI for x64 Windows'
  Write-Host '  windows-arm64  DeepSeek Harness CLI for ARM64 Windows'
}

if ($Target -eq '' -or $Target -eq 'help' -or $Target -eq '--help' -or $Target -eq '-h') {
  Usage
  if ($Target -eq '') { Fail 'choose one installation target.' }
  exit 0
}

$IsWin = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)
$Arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture

switch ($Target) {
  'windows-x64' {
    if (-not ($IsWin -and $Arch -eq [System.Runtime.InteropServices.Architecture]::X64)) {
      Fail "windows-x64 requires x64 Windows; detected $Arch."
    }
    $Asset = 'deepseek-harness-windows-x64.zip'
  }
  'windows-arm64' {
    if (-not ($IsWin -and $Arch -eq [System.Runtime.InteropServices.Architecture]::Arm64)) {
      Fail "windows-arm64 requires ARM64 Windows; detected $Arch."
    }
    $Asset = 'deepseek-harness-windows-arm64.zip'
  }
  default {
    Usage
    Fail "unknown installation target $Target"
  }
}

$InstallRoot = if ($env:DEEPSEEK_HARNESS_INSTALL_ROOT) { $env:DEEPSEEK_HARNESS_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'DeepSeek Harness CLI' }
$BinDir = if ($env:DEEPSEEK_HARNESS_BIN_DIR) { $env:DEEPSEEK_HARNESS_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'DeepSeek Harness\bin' }
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:LOCALAPPDATA 'DeepSeek Harness' }

$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ('deepseek-harness-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temp | Out-Null
try {
  $Checksums = Join-Path $Temp 'SHA256SUMS'
  $Archive = Join-Path $Temp $Asset
  Invoke-WebRequest -Uri "$ReleaseBase/SHA256SUMS" -OutFile $Checksums
  Invoke-WebRequest -Uri "$ReleaseBase/$Asset" -OutFile $Archive

  $Expected = $null
  foreach ($Line in Get-Content $Checksums) {
    if ($Line -match "^\s*([0-9a-fA-F]{64})\s+$([regex]::Escape($Asset))\s*$") {
      $Expected = $Matches[1].ToLowerInvariant()
      break
    }
  }
  if (-not $Expected) { Fail "SHA256SUMS has no entry for $Asset" }

  $Actual = (Get-FileHash -Path $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { Fail "checksum mismatch for $Asset" }

  $Extract = Join-Path $Temp 'cli'
  Expand-Archive -Path $Archive -DestinationPath $Extract

  $StagedCli = Join-Path $Extract 'DeepSeek Harness CLI'
  if (Test-Path $InstallRoot) {
    $Backup = "$InstallRoot.backup-" + (Get-Date -Format 'yyyyMMddTHHmmssZ')
    Move-Item $InstallRoot $Backup
    Write-Host "Backed up $InstallRoot to $Backup"
  }
  New-Item -ItemType Directory -Path (Split-Path $InstallRoot) -Force | Out-Null
  Move-Item $StagedCli $InstallRoot

  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  $Shim = Join-Path $BinDir 'dsh.cmd'
  if (Test-Path $Shim) { Remove-Item $Shim -Force }
  $Launcher = Join-Path $InstallRoot 'bin\dsh.cmd'
  "@echo off`r`ncall `"$Launcher`" %*`r`n" | Set-Content -Path $Shim -Encoding Ascii

  New-Item -ItemType Directory -Path $DshHome -Force | Out-Null
  $HomePatch = Join-Path $DshHome 'cordis.patch.yml'
  $HomePatchSource = Join-Path $InstallRoot 'config\cordis.patch.yml'
  if (Test-Path $HomePatchSource) {
    Copy-Item $HomePatchSource $HomePatch -Force
    Write-Host "Installed home patch: $HomePatch"
  }

  Write-Host "Installed CLI: $Shim"
}
finally {
  Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
}

Write-Host "DeepSeek Harness $Target installation complete."
if (-not ($env:Path -split ';' -contains $BinDir)) {
  Write-Host "Add $BinDir to PATH, then run: dsh --help"
}
