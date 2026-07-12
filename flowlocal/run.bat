@echo off
REM Start FlowLocal. Runs in the background with a system-tray icon.
cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" (
    echo Virtual environment not found. Run install.bat first.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"
python -m flowlocal
