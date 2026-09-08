# Chay trong PowerShell (KHONG phai CMD):
#   powershell -ExecutionPolicy Bypass -File "D:\Java 6\be-uniwork\uniwork\scripts\cleanup-disk.ps1"
#
# Log luon ghi ra o D: de tranh fail khi o C: day.

$ErrorActionPreference = "SilentlyContinue"
$log = "D:\Java 6\be-uniwork\uniwork\disk-cleanup-log.txt"

function Write-Log($msg) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
  Write-Host $line
  try { Add-Content -Path $log -Value $line -Encoding UTF8 } catch {}
}

function Get-FreeGB($drive) {
  $vol = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}:'" -ErrorAction SilentlyContinue
  if ($vol) { return [math]::Round($vol.FreeSpace / 1GB, 2) }
  return 0
}

function Clear-FolderFast($path, $label) {
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Log "Bo qua (khong ton tai): $label"
    return
  }
  Write-Log "Dang xoa: $label -> $path"
  Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  Write-Log "Xong: $label"
}

function Clear-FileGlob($pattern, $label) {
  Write-Log "Dang xoa: $label"
  Get-ChildItem -Path $pattern -Force -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Write-Log "Xong: $label"
}

"" | Set-Content -Path $log -Encoding UTF8
Write-Log "=== TRUOC DON ==="
Write-Log "C: con $(Get-FreeGB 'C') GB"
Write-Log "D: con $(Get-FreeGB 'D') GB"

# --- O C: (uu tien vi day) ---
Clear-FolderFast $env:TEMP "Temp user"
Clear-FolderFast "$env:LOCALAPPDATA\Temp" "LocalAppData\Temp"
Clear-FolderFast "C:\Windows\Temp" "Windows\Temp"
Clear-FolderFast "$env:LOCALAPPDATA\pnpm\store" "pnpm store (C:)"
Clear-FolderFast "$env:LOCALAPPDATA\npm-cache" "npm cache"
Clear-FolderFast "$env:APPDATA\npm-cache" "npm cache (Roaming)"
Clear-FolderFast "$env:LOCALAPPDATA\go-build" "Go build cache"
Clear-FolderFast "$env:USERPROFILE\go\pkg\mod\cache" "Go mod download cache"
Clear-FolderFast "$env:LOCALAPPDATA\Microsoft\Windows\INetCache" "IE/Edge INetCache"
Clear-FolderFast "$env:LOCALAPPDATA\D3DSCache" "D3D shader cache"
Clear-FolderFast "$env:LOCALAPPDATA\CrashDumps" "Crash dumps"
Clear-FolderFast "$env:LOCALAPPDATA\Microsoft\Windows\Explorer" "Explorer thumbs (se tao lai)"
Clear-FolderFast "$env:LOCALAPPDATA\Packages\Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy\LocalState\Assets" "Windows spotlight cache"

# Cursor / VS Code caches (rat hay day o C:)
Clear-FolderFast "$env:APPDATA\Cursor\Cache" "Cursor Cache"
Clear-FolderFast "$env:APPDATA\Cursor\CachedData" "Cursor CachedData"
Clear-FolderFast "$env:APPDATA\Cursor\Code Cache" "Cursor Code Cache"
Clear-FolderFast "$env:APPDATA\Cursor\GPUCache" "Cursor GPUCache"
Clear-FolderFast "$env:APPDATA\Cursor\logs" "Cursor logs"
Clear-FolderFast "$env:APPDATA\Code\Cache" "VS Code Cache"
Clear-FolderFast "$env:APPDATA\Code\CachedData" "VS Code CachedData"
Clear-FolderFast "$env:APPDATA\Code\Code Cache" "VS Code Code Cache"
Clear-FolderFast "$env:APPDATA\Code\GPUCache" "VS Code GPUCache"
Clear-FolderFast "$env:APPDATA\Code\logs" "VS Code logs"

# Turborepo / vite caches tren profile
Clear-FolderFast "$env:LOCALAPPDATA\.turbo" "Turbo cache (LocalAppData)"
Clear-FolderFast "$env:USERPROFILE\.turbo" "Turbo cache (Home)"

# Docker (neu co)
Clear-FolderFast "$env:LOCALAPPDATA\Docker" "Docker LocalAppData"
Clear-FolderFast "$env:PROGRAMDATA\Docker" "Docker ProgramData"

# NuGet / pip
Clear-FolderFast "$env:USERPROFILE\.nuget\packages" "NuGet packages cache"
Clear-FolderFast "$env:LOCALAPPDATA\pip\Cache" "pip cache"

# --- O D: (project caches) ---
Clear-FolderFast "D:\Java 6\be-uniwork\uniwork\apps\web\.next" "Next.js .next"
Clear-FolderFast "D:\Java 6\be-uniwork\uniwork\packages\views\node_modules\.vite" "Vitest/Vite cache"
Clear-FolderFast "D:\Java 6\be-uniwork\uniwork\node_modules\.cache" "node_modules .cache"
Clear-FileGlob "D:\Java 6\be-uniwork\uniwork\**\.turbo" "Turbo cache trong repo"

try {
  Clear-RecycleBin -Force -ErrorAction Stop
  Write-Log "Da lam trong Thung rac"
} catch {
  Write-Log "Khong lam trong duoc Thung rac (bo qua)"
}

Push-Location "D:\Java 6\be-uniwork\uniwork"
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  pnpm store prune 2>&1 | Out-Null
  Write-Log "Da chay pnpm store prune"
}
if (Get-Command npm -ErrorAction SilentlyContinue) {
  npm cache clean --force 2>&1 | Out-Null
  Write-Log "Da chay npm cache clean"
}
if (Get-Command go -ErrorAction SilentlyContinue) {
  go clean -cache -modcache 2>&1 | Out-Null
  Write-Log "Da chay go clean -cache -modcache"
}
Pop-Location

Write-Log "=== SAU DON ==="
Write-Log "C: con $(Get-FreeGB 'C') GB"
Write-Log "D: con $(Get-FreeGB 'D') GB"
Write-Log "Log: $log"
Write-Log "Neu C: van day, chay scripts/scan-disk-c.ps1 de xem thu muc lon nhat."
