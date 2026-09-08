# UniWork — dọn cache/temp an toàn trên Windows (C: + D:)
# Chạy: PowerShell > Set-ExecutionPolicy -Scope Process Bypass > .\scripts\free-disk-space.ps1

$ErrorActionPreference = 'SilentlyContinue'

function Get-FolderSizeMB([string]$Path) {
    if (-not (Test-Path $Path)) { return 0 }
    $sum = (Get-ChildItem $Path -Recurse -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if ($null -eq $sum) { return 0 }
    return [math]::Round($sum / 1MB, 0)
}

function Clear-FolderContents([string]$Path) {
    if (-not (Test-Path $Path)) { return 0 }
    $before = Get-FolderSizeMB $Path
    Get-ChildItem $Path -Force -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    return $before
}

Write-Host "=== TRUOC KHI DON ===" -ForegroundColor Cyan
Get-PSDrive C, D | ForEach-Object {
    $free = [math]::Round($_.Free / 1GB, 2)
    $total = [math]::Round(($_.Used + $_.Free) / 1GB, 2)
    Write-Host "$($_.Name): con $free GB / $total GB"
}

$targets = @(
    $env:TEMP,
    "$env:LOCALAPPDATA\Temp",
    "$env:USERPROFILE\AppData\Local\Temp",
    "$env:LOCALAPPDATA\go-build",
    "$env:LOCALAPPDATA\pnpm\cache",
    "$env:LOCALAPPDATA\npm-cache",
    "$env:LOCALAPPDATA\Cursor\Cache",
    "$env:LOCALAPPDATA\Cursor\CachedData",
    "$env:LOCALAPPDATA\Cursor\logs",
    "$env:LOCALAPPDATA\Microsoft\Windows\INetCache",
    "$env:LOCALAPPDATA\Microsoft\Windows\WebCache",
    "D:\Java 6\be-uniwork\uniwork\apps\web\.next",
    "D:\Java 6\be-uniwork\uniwork\packages\views\node_modules\.vite",
    "D:\Java 6\be-uniwork\uniwork\apps\web\node_modules\.cache"
)

$totalFreed = 0
foreach ($path in $targets) {
    $freed = Clear-FolderContents $path
    if ($freed -gt 0) {
        $totalFreed += $freed
        Write-Host "Da xoa: $path (~$freed MB)" -ForegroundColor Green
    }
}

try {
    Clear-RecycleBin -Force -ErrorAction Stop
    Write-Host "Da xoa Thung rac" -ForegroundColor Green
} catch {
    Write-Host "Thung rac: bo qua hoac trong" -ForegroundColor Yellow
}

if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    pnpm store prune | Out-Null
    Write-Host "pnpm store prune: xong" -ForegroundColor Green
}

if (Get-Command npm -ErrorAction SilentlyContinue) {
    npm cache clean --force | Out-Null
    Write-Host "npm cache clean: xong" -ForegroundColor Green
}

if (Get-Command go -ErrorAction SilentlyContinue) {
    go clean -cache -testcache | Out-Null
    Write-Host "go clean cache: xong" -ForegroundColor Green
}

Write-Host ""
Write-Host "Uoc tinh da giai phong: ~$totalFreed MB" -ForegroundColor Cyan
Write-Host "=== SAU KHI DON ===" -ForegroundColor Cyan
Get-PSDrive C, D | ForEach-Object {
    $free = [math]::Round($_.Free / 1GB, 2)
    $total = [math]::Round(($_.Used + $_.Free) / 1GB, 2)
    Write-Host "$($_.Name): con $free GB / $total GB"
}

Write-Host ""
Write-Host "Neu van day, mo Settings > System > Storage > Temporary files va chon Don dep." -ForegroundColor Yellow
