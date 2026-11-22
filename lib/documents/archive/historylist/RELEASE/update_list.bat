@echo off
rem ============================================================
rem  LongwaySite History List Updater
rem  1) Rebuilds RELEASE\list.txt       (big versions)
rem  2) Rebuilds RELEASE\<big>\list.txt (minor versions)
rem  Rules:
rem    - A big version = a folder directly under RELEASE
rem    - A minor version = a folder under a big version that
rem      contains content.md (one folder = one log)
rem    - Big versions without any minor log are skipped and
rem      reported (so half-made folders do not leak into list)
rem    - Entries are sorted NEWEST FIRST (1.10 before 1.9,
rem      numeric segments compared, not plain text)
rem    - list.txt is written as UTF-8 without BOM, CRLF
rem  Usage: double-click to run. No arguments needed.
rem  Beta has no list.txt: it is a single BETA\content.md.
rem ============================================================
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo Scanning big versions...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; function Key([string]$s){ ($s -split '\.' | ForEach-Object { $n = 0; if ([int]::TryParse($_, [ref]$n)) { $n.ToString('D6') } else { $_ } }) -join '.' }; function SortDesc([string[]]$a){ @($a | Sort-Object -Property @{ Expression = { Key $_ } } -Descending) }; function WriteList([string]$path, $arr){ $a = @($arr); $enc = New-Object System.Text.UTF8Encoding($false); $crlf = ([char]13).ToString() + ([char]10).ToString(); if ($a.Count -gt 0) { $txt = ($a -join $crlf) + $crlf } else { $txt = '' }; [System.IO.File]::WriteAllText($path, $txt, $enc) }; $bigs = @(); foreach ($d in (Get-ChildItem -Path '.' -Directory -Force)) { $minors = @(Get-ChildItem -Path $d.FullName -Directory -Force | Where-Object { Test-Path (Join-Path $_.FullName 'content.md') }); if ($minors.Count -eq 0) { Write-Output ('[skip] ' + $d.Name + ' (no content.md under it)'); continue }; $names = @(SortDesc ([string[]]@($minors | ForEach-Object { $_.Name }))); WriteList (Join-Path $d.FullName 'list.txt') $names; Write-Output ('  ' + $d.Name + ': ' + ($names -join ', ')); $bigs += $d.Name }; $bigNames = @(SortDesc ([string[]]$bigs)); WriteList (Join-Path $PWD 'list.txt') $bigNames; Write-Output ('list.txt updated: ' + $bigNames.Count + ' big version(s).')"

if %errorlevel% neq 0 (
    echo [ERROR] Failed to update. Check permissions or folder structure.
    pause
    exit /b 1
)

echo.
echo RELEASE list.txt:
type list.txt
echo.
for /d %%D in (*) do (
    if exist "%%D\list.txt" (
        echo %%D\list.txt:
        type "%%D\list.txt"
        echo.
    )
)
endlocal
