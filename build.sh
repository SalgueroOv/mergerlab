#!/usr/bin/env bash
# Build completo de Merger Lab para macOS/Linux:
#   1) Empaqueta el backend Python con PyInstaller (--onedir)
#   2) Compila el frontend React (Vite)
#   3) Genera los distribuibles (instalador + portable) con electron-builder
#
# Requisitos previos: Python 3.9+, Node.js 18+, npm.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> 1/5 Creando entorno virtual de Python (si no existe)"
if [ ! -d "backend/venv" ]; then
  python3 -m venv backend/venv
fi
# shellcheck disable=SC1091
source backend/venv/bin/activate

echo "==> 2/5 Instalando dependencias Python"
python3 -m pip install --upgrade pip
pip install -r backend/requirements.txt

echo "==> 3/5 Empaquetando backend con PyInstaller (--onedir)"
rm -rf build/pyi-work resources/backend
mkdir -p resources/backend
# --onedir en vez de --onefile: el ejecutable arranca directo desde su carpeta, sin
# autoextraerse a una carpeta temporal en cada arranque (eso hacia lento el arranque de
# la app empaquetada). Genera resources/backend/merger-backend/merger-backend.
pyinstaller backend/server.py \
  --name merger-backend \
  --onedir \
  --distpath resources/backend \
  --workpath build/pyi-work \
  --specpath build \
  --hidden-import odf.opendocument \
  --hidden-import odf.table \
  --hidden-import odf.text \
  --collect-submodules odf \
  --noconfirm

deactivate

echo "==> 4/5 Instalando dependencias Node e integrando el frontend"
npm install
npm run build:frontend

echo "==> 5/5 Generando distribuibles con electron-builder"
npx electron-builder

echo ""
echo "Listo. Los instaladores/portables están en la carpeta 'release/'."
echo "Nota: electron-builder solo puede firmar/generar .dmg de macOS ejecutándose en macOS,"
echo "y .AppImage de Linux ejecutándose en Linux (o vía contenedor Docker compatible)."
