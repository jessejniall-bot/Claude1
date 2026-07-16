@echo off
REM Double-click to run Murmur. It serves the page on http://localhost so the
REM microphone works (browsers block voice on plain file:// pages), then opens
REM your browser. Use Chrome or Edge.
cd /d "%~dp0"

echo Starting Murmur...
echo.
echo   A browser tab will open at:  http://localhost:8000/murmur.html
echo   Use Chrome or Edge for voice input.
echo.
echo   A second window ("Murmur server") will open and stay running.
echo   Close that window when you're done to stop Murmur.
echo.

start "Murmur server" cmd /c "py -3 -m http.server 8000 2>nul || python -m http.server 8000"
timeout /t 2 >nul
start "" http://localhost:8000/murmur.html
