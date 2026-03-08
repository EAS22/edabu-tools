@echo off
title Edabu Proxy Server
echo ===================================================
echo Memulai Server Proxy Edabu di latar belakang...
echo Mohon tunggu sebentar...
echo ===================================================

:: Menjalankan server Node.js di terminal terpisah
start cmd /k "node index.js"

:: Jeda 4 detik untuk memastikan server Node.js sudah menyala penuh
timeout /t 4 /nobreak >nul

:: Membuka file index.html langsung di browser default PC lu
start index.html

exit