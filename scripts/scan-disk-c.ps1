# Quet thu muc lon tren o C: (ket qua ghi ra o D:)
#   powershell -ExecutionPolicy Bypass -File "D:\Java 6\be-uniwork\uniwork\scripts\scan-disk-c.ps1"

$ErrorActionPreference = "SilentlyContinue"
$out = "D:\Java 6\be-uniwork\uniwork\disk-scan-c.txt"

function Folder-SizeGB($path) {
  if (-not (Test-Path -LiteralPath $path)) { return 0 }
  $sum = (Get-ChildItem -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
  if (-not $sum) { return 0 }
  return [math]::Round($sum / 1GB, 2)
}

$roots = @(
  "$env:USERPROFILE",
  "$env:LOCALAPPDATA",
  "$env:APPDATA",
  "C:\Program Files",
  "C:\Program Files (x86)",
  "C:\Windows"
)

"" | Set-Content $out
Add-Content $out "=== TOP THU MUC CON (cap 1) TREN C: === $(Get-Date)"

foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  Add-Content $out ""
  Add-Content $out "--- $root ---"
  $items = Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
      [PSCustomObject]@{
        Path = $_.FullName
        SizeGB = Folder-SizeGB $_.FullName
      }
    } |
    Sort-Object SizeGB -Descending |
    Select-Object -First 15
  $items | ForEach-Object { Add-Content $out ("{0,8} GB  {1}" -f $_.SizeGB, $_.Path) }
}

Add-Content $out ""
Add-Content $out "Ket qua: $out"
Write-Host "Xong. Mo file: $out"
