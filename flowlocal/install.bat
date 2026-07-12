@echo off
REM One-time setup: creates a local virtual environment and installs dependencies.
cd /d "%~dp0"

echo Creating virtual environment...
py -3 -m venv .venv 2>nul || python -m venv .venv
if not exist ".venv\Scripts\activate.bat" (
    echo.
    echo ERROR: Could not create a virtual environment. Is Python 3 installed?
    echo Download it from https://www.python.org/downloads/ and tick "Add to PATH".
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r requirements.txt

echo.
echo ============================================
echo   Setup complete. Double-click run.bat to start FlowLocal.
echo ============================================
pause
