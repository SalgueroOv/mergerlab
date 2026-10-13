@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem Build rapido para iterar: solo genera el .exe portable (sin instalador NSIS).
rem CSC_IDENTITY_AUTO_DISCOVERY evita que electron-builder busque certificados de firma.
set CSC_IDENTITY_AUTO_DISCOVERY=false

echo ==^> 1/4 Creando entorno virtual de Python (si no existe)
if not exist backend\venv (
    python -m venv backend\venv
    if errorlevel 1 goto :error
)
call backend\venv\Scripts\activate.bat

echo ==^> 2/4 Instalando dependencias Python
pip install -r backend\requirements.txt
if errorlevel 1 goto :error

echo ==^> 3/4 Empaquetando backend con PyInstaller (--onedir)
if exist resources\backend rmdir /s /q resources\backend
if exist build\pyi-work rmdir /s /q build\pyi-work
mkdir resources\backend

pyinstaller backend\server.py ^
  --name merger-backend ^
  --onedir ^
  --distpath resources\backend ^
  --workpath build\pyi-work ^
  --specpath build ^
  --hidden-import odf.opendocument ^
  --hidden-import odf.table ^
  --hidden-import odf.text ^
  --collect-submodules odf ^
  --hidden-import lxml.etree ^
  --hidden-import lxml.html ^
  --noconfirm
if errorlevel 1 goto :error

call backend\venv\Scripts\deactivate.bat

echo ==^> 4/4 Frontend + empaquetado portable (sin NSIS)
call npm run build:frontend
if errorlevel 1 goto :error
call npx electron-builder --win portable
if errorlevel 1 goto :error

echo.
echo Listo. release\Merger Lab-Portable-1.0.0-x64.exe actualizado.
goto :eof

:error
echo.
echo ERROR: el proceso de build se detuvo. Revisa el mensaje anterior.
exit /b 1
