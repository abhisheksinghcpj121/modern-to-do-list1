@echo off
title Smart Study Server
cd /d "%~dp0"

echo.
echo   Starting Smart Study server...
echo   App   : http://localhost:3000
echo   Admin : http://localhost:3000/admin.html
echo.
echo   Keep this window open while using the app.
echo   Close it to stop the server.
echo.

node server\server.js

echo.
echo   Server stopped (or port 3000 was already in use).
echo   Press any key to close.
pause >nul
