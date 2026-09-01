@echo off
rem ============================================================
rem  LongWeb Blog List Updater
rem  Scans article folders under lib\words\blogs and rebuilds
rem  list.txt automatically.
rem  Rules:
rem    - .Default is excluded (default data folder)
rem    - Only folders containing passage.md are treated as
rem      articles (one folder = one article)
rem  Usage: double-click to run. No UI, exits when done.
rem ============================================================
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo Scanning article folders...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $dirs = Get-ChildItem -Path '.' -Directory -Force | Where-Object { $_.Name -ne '.Default' }; $valid = @(); foreach ($d in $dirs) { if (Test-Path (Join-Path $d.FullName 'passage.md')) { $valid += $d.Name } }; $valid = $valid | Sort-Object; $enc = New-Object System.Text.UTF8Encoding($true); if ($valid.Count -gt 0) { [System.IO.File]::WriteAllLines((Join-Path $PWD 'list.txt'), $valid, $enc) } else { [System.IO.File]::WriteAllText((Join-Path $PWD 'list.txt'), '', $enc) }; Write-Output ('Done: ' + $valid.Count + ' article(s) detected, list.txt updated.')"

if %errorlevel% neq 0 (
    echo [ERROR] Failed to update list.txt. Check permissions or folder structure.
    pause
    exit /b 1
)

echo.
echo list.txt content:
type list.txt
echo.
endlocal
