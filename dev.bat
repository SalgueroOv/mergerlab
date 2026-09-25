@echo off
rem Modo desarrollo: abre Vite (recarga en caliente) y Electron en dos ventanas separadas.
rem No genera ningun .exe ni pasa por PyInstaller/electron-builder - es para probar cambios de codigo al instante.
cd /d "%~dp0"

start "Merger Lab - Vite (frontend)" cmd /k "npm run dev:frontend"

echo Esperando a que Vite arranque en el puerto 5173...
npx wait-on tcp:5173

rem Comillas en el set: sin ellas cmd guarda el espacio antes de "&&" (NODE_ENV="development ")
rem y Electron no reconoce el modo desarrollo.
start "Merger Lab - Electron" cmd /k "call backend\venv\Scripts\activate.bat && set "NODE_ENV=development" && npx electron ."
