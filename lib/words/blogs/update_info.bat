@echo off
rem ============================================================
rem  LongWeb Blog Info Updater
rem  1) Renames each article folder to its metadata ID
rem     (read from info\tag.txt line 5)
rem  2) Rebuilds list.txt with article IDs
rem  Rules:
rem    - .Default is excluded (default data folder)
rem    - Only folders containing passage.md are treated as
rem      articles (one folder = one article)
rem    - If tag.txt is missing/invalid, folder is kept as-is
rem      and listed using its folder name
rem    - If the target ID already exists, the folder is skipped
rem      (not renamed, not listed) and a warning is printed
rem  Usage: double-click to run. No UI, exits when done.
rem ============================================================
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo Scanning article folders...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $dirs = Get-ChildItem -Path '.' -Directory -Force | Where-Object { $_.Name -ne '.Default' }; $ids = @(); $renamed = 0; $skipped = @(); $usedIds = @{}; foreach ($d in $dirs) { if (-not (Test-Path (Join-Path $d.FullName 'passage.md'))) { continue }; $tagPath = Join-Path $d.FullName 'info\tag.txt'; $id = ''; if (Test-Path $tagPath) { $lines = Get-Content -Path $tagPath -Encoding UTF8; if ($lines.Count -ge 5) { $id = ($lines[4]).Trim() } }; $folderName = $d.Name; if ($id) { if ($usedIds.ContainsKey($id)) { $skipped += ($folderName + ' (id=' + $id + ' duplicated)'); continue }; $targetPath = Join-Path $PWD $id; if ($id -ne $folderName) { if (Test-Path $targetPath) { $skipped += ($folderName + ' (id=' + $id + ' exists)'); continue } else { Rename-Item -Path $d.FullName -NewName $id; $renamed++; $folderName = $id } }; $usedIds[$id] = $true; $ids += $id } else { $ids += $folderName } }; $ids = $ids | Sort-Object; $enc = New-Object System.Text.UTF8Encoding($true); if ($ids.Count -gt 0) { [System.IO.File]::WriteAllLines((Join-Path $PWD 'list.txt'), $ids, $enc) } else { [System.IO.File]::WriteAllText((Join-Path $PWD 'list.txt'), '', $enc) }; Write-Output ('Renamed: ' + $renamed + ' folder(s).'); if ($skipped.Count -gt 0) { Write-Output ('Skipped: ' + ($skipped -join '; ')) }; Write-Output ('list.txt updated with ' + $ids.Count + ' ID(s).')"

if %errorlevel% neq 0 (
    echo [ERROR] Failed to update. Check permissions or folder structure.
    pause
    exit /b 1
)

echo.
echo list.txt content:
type list.txt
echo.
endlocal
