@echo off
title Hentikan Edabu Proxy
echo ===================================================
echo Mematikan Server Proxy Edabu yang berjalan di latar belakang...
echo ===================================================

:: Menghentikan paksa semua proses node.exe
taskkill /F /IM node.exe

echo.
echo Server telah berhasil dihentikan!
pause
