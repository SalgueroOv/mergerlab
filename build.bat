@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem "build.bat publish" ademas sube los instaladores + latest.yml a un GitHub Release (lo que
rem necesita electron-updater para avisar de la version nueva). Requiere la variable GH_TOKEN.
set PUBLISH_FLAG=--publish never
if /i "%~1"=="publish" (
    if "%GH_TOKEN%"=="" (
        echo ERROR: falta la variable de entorno GH_TOKEN ^(token de GitHub con permiso "repo"^).
        exit /b 1
    )
    set PUBLISH_FLAG=--publish always
)

echo ==^> 1/5 Creando entorno virtual de Python (si no existe)
if not exist backend\venv (
    python -m venv backend\venv
    if errorlevel 1 goto :error
)
call backend\venv\Scripts\activate.bat

echo ==^> 2/5 Instalando dependencias Python
python -m pip install --upgrade pip
if errorlevel 1 goto :error
pip install -r backend\requirements.txt
if errorlevel 1 goto :error

echo ==^> 3/5 Empaquetando backend con PyInstaller (--onedir)
if exist resources\backend rmdir /s /q resources\backend
if exist build\pyi-work rmdir /s /q build\pyi-work
mkdir resources\backend

rem --onedir en vez de --onefile: el ejecutable arranca directo desde su carpeta, sin
rem autoextraerse a una carpeta temporal en cada arranque (eso es lo que hacia lento el
rem arranque de la app empaquetada). Genera resources\backend\merger-backend\merger-backend.exe.
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

echo ==^> 4/5 Instalando dependencias Node e integrando el frontend
call npm install
if errorlevel 1 goto :error
call npm run build:frontend
if errorlevel 1 goto :error

echo ==^> 5/5 Generando distribuibles con electron-builder (instalador NSIS + portable)
call npx electron-builder --win nsis portable %PUBLISH_FLAG%
if errorlevel 1 goto :error

echo.
echo Listo. Los instaladores/portables estan en la carpeta 'release\'.
goto :eof

:error
echo.
echo ERROR: el proceso de build se detuvo. Revisa el mensaje anterior.
exit /b 1
