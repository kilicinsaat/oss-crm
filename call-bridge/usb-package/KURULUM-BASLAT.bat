@echo off
chcp 65001 >nul
title OSS Call Bridge Kurulum

echo.
echo OSS Call Bridge kurulumu baslatiliyor...
echo Bu pencere izin isterse "Evet" de.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0kurulum.ps1"

echo.
pause
