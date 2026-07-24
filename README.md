# Merger Lab

Aplicación de escritorio multiplataforma (Windows, macOS, Linux) para combinar múltiples
archivos de hoja de cálculo (`.xls`, `.xlsx`, `.csv`, `.ods`) en un único archivo de salida,
en cualquiera de esos mismos formatos.

## Arquitectura

- **UI**: Electron + React (Vite).
- **Backend**: Python (pandas, openpyxl, xlrd, odfpy, xlwt) empaquetado con PyInstaller en modo
  `--onefile`. Se ejecuta como proceso independiente que Electron lanza al arrancar.
- **Comunicación UI ↔ Backend**: HTTP local. El backend elige un puerto libre en `127.0.0.1`,
  lo imprime por stdout (`PORT:<numero>`) y Electron lo reenvía al renderer vía IPC. El
  renderer hace `fetch` directamente contra `http://127.0.0.1:<puerto>` para iniciar la
  combinación y sondear el progreso.
- **Empaquetado**: electron-builder genera instalador NSIS (sin requerir permisos de
  administrador) + versión portable para Windows, `.dmg` para macOS y `.AppImage` para Linux.
  El ejecutable de PyInstaller se incluye como recurso extra (`extraResources`) dentro del
  paquete de Electron, fuera del asar.

```
├── electron/           # Proceso principal de Electron (main.js) + preload.js
├── src/                # Frontend React (Vite)
│   └── components/
├── backend/             # Backend Python (server.py = API HTTP, merger.py = lógica de combinación)
├── resources/backend/   # (generado) ejecutable de PyInstaller antes de empaquetar con Electron
├── build.sh / build.bat # Build completo: PyInstaller + frontend + electron-builder
└── electron-builder.yml
```

## Requisitos previos (solo para desarrollo/build, NO para el usuario final)

- Node.js 18+
- Python 3.9+ con `venv`
- En Windows, `python` debe estar en el PATH; en macOS/Linux, `python3`.

El usuario final que instala el `.exe`/`.dmg`/`.AppImage` **no necesita instalar nada**:
Node, Python y todas las dependencias van embebidas en el paquete.

## Desarrollo

1. Instalar dependencias Node:

   ```bash
   npm install
   ```

2. Crear un entorno virtual e instalar dependencias Python (solo la primera vez):

   ```bash
   python3 -m venv backend/venv
   source backend/venv/bin/activate   # Windows: backend\venv\Scripts\activate
   pip install -r backend/requirements.txt
   ```

3. Levantar el entorno de desarrollo (Vite + Electron con recarga en caliente del frontend).
   Con el entorno virtual de Python activado (para que `python`/`python3` resuelva a esa
   instalación con las dependencias instaladas):

   ```bash
   npm run dev
   ```

   Esto arranca Vite en `http://localhost:5173`, espera a que esté listo y luego lanza
   Electron, que a su vez arranca `backend/server.py` como proceso hijo.

## Build de distribución (instalador + portable)

El flujo completo (empaquetar backend con PyInstaller → compilar frontend → generar
instaladores) está automatizado:

- **Windows**: `build.bat`
- **macOS / Linux**: `./build.sh`

Al finalizar, los artefactos quedan en `release/`:

- Windows: `Merger Lab-Setup-<version>-x64.exe` (instalador NSIS, sin admin) y
  `Merger Lab-Portable-<version>-x64.exe` (portable).
- macOS: `Merger Lab-<version>-<arch>.dmg`.
- Linux: `Merger Lab-<version>-x64.AppImage`.

> **Nota sobre compilación cruzada**: electron-builder solo puede generar `.dmg` firmados
> ejecutándose en macOS, y `.AppImage` ejecutándose en Linux (o mediante contenedores
> compatibles). Para generar los tres paquetes hay que ejecutar el script correspondiente en
> cada sistema operativo.

### Pasos manuales equivalentes

Si prefieres ejecutar los pasos por separado:

```bash
# 1) Empaquetar backend
pip install -r backend/requirements.txt pyinstaller
pyinstaller backend/server.py --name merger-backend --onefile \
  --distpath resources/backend --workpath build/pyi-work --specpath build \
  --collect-submodules odf --noconfirm

# 2) Compilar frontend
npm run build:frontend

# 3) Generar distribuibles
npx electron-builder                 # todos los targets configurados para el SO actual
npm run dist:win                     # solo Windows (nsis + portable)
npm run dist:mac                     # solo macOS (dmg)
npm run dist:linux                   # solo Linux (AppImage)
```

## Funcionamiento

1. El usuario agrega uno o varios archivos (`.xls`, `.xlsx`, `.csv`, `.ods`) mediante el
   selector nativo del sistema operativo.
2. La lista muestra el orden en que se combinarán; se puede reordenar (↑/↓) o quitar archivos.
3. Elige el modo de combinación (por defecto, **join**):
   - **Join** (`backend/merger.py::join_files`): cruza los archivos por una columna clave,
     elegida por separado para cada archivo (pueden tener nombres distintos entre sí — ver
     "Columna clave con nombres distintos" más abajo). Con más de dos archivos se encadena en
     el orden de la lista (archivo 1 ⋈ 2, ese resultado ⋈ 3, …).
   - **Apilar filas** (`backend/merger.py::merge_files`): concatena los archivos uno debajo del
     otro, alineando columnas por nombre (unión; las celdas sin correspondencia quedan vacías).
4. Elige el formato de salida (`.xlsx`, `.xls`, `.csv`, `.ods`).
5. Al pulsar "Combinar archivos", se elige la ruta de guardado con el diálogo nativo y la app
   envía la solicitud al backend Python, que hace el trabajo y reporta progreso reflejado en la
   barra de progreso de la UI.

### Columna clave con nombres distintos (modo join)

Cada archivo tiene su propio selector de columna clave (`JoinPicker.jsx`) — no hace falta que se
llamen igual entre archivos (ej. "ID_Cliente" en uno y "Codigo Cliente" en otro). Al encadenar
más de dos archivos, `join_files` fusiona automáticamente la clave acumulada con la del siguiente
archivo después de cada paso (usando `left_on`/`right_on` y completando huecos con `where`), y la
columna clave final del resultado conserva el nombre de la clave elegida en el primer archivo.
Ver el docstring de `join_files` en `backend/merger.py` para el detalle del algoritmo.

## Tutoriales y ayuda

- **Tutoriales contextuales**: el botón "?" junto a "Tipo de join" y junto a "Opciones" (modo
  apilar) abre un modal con diagramas explicando cómo funciona cada modo
  (`JoinTutorial.jsx` / `StackTutorial.jsx`).
- **Recorrido de bienvenida** (`OnboardingTour.jsx`): la primera vez que se abre la app (se
  guarda un flag en `localStorage`, clave `mergerlab.onboarding.completed`), se resaltan en
  secuencia los controles principales con un overlay tipo spotlight. Cualquier click dentro de
  la ventana avanza al siguiente paso (no hay botón "Siguiente"); Esc lo cierra. Se puede volver
  a ver desde "Acerca de" → "Ver tutorial de bienvenida".
  - Para agregar/editar pasos: modificar el arreglo `STEPS` en `src/components/OnboardingTour.jsx`
    (cada paso es `{ selector, title, body }`, donde `selector` es cualquier selector CSS de un
    elemento ya presente en el DOM).

## Tema claro/oscuro

Selector de 3 vías (Sistema / Claro / Oscuro) en el header (`ThemeToggle.jsx`), por defecto en
"Sistema". Se implementa con `nativeTheme.themeSource` de Electron (`electron/main.js`) en vez de
una clase/atributo CSS propio: al cambiarlo, Chromium reevalúa en caliente `prefers-color-scheme`
en todas las ventanas abiertas (principal y "Acerca de") sin recargar nada, así que `styles.css` y
`about.css` no necesitan lógica de tema aparte — ya usan `@media (prefers-color-scheme: dark)`.
Electron no persiste `themeSource` entre reinicios, por eso se guarda en un archivo propio
(`app.getPath("userData")/theme.json`) que se lee al arrancar, antes de crear cualquier ventana.

## Manejo de errores

- **Archivo corrupto o protegido**: se captura la excepción de lectura y se muestra un mensaje
  indicando qué archivo falló.
- **Formato no soportado**: se valida la extensión antes de leer/escribir.
- **Sin permisos de escritura**: se valida que la carpeta destino exista y sea escribible antes
  de combinar, y se captura `PermissionError` al guardar (por ejemplo, archivo abierto en otro
  programa).
- **Backend caído**: si el proceso Python no arranca o se cae, Electron muestra un diálogo de
  error nativo con el detalle.

## Limitaciones conocidas

- El formato `.xls` clásico admite un máximo de 65 535 filas de datos; si el resultado
  combinado lo supera, se recomienda exportar a `.xlsx`, `.csv` u `.ods`.
- Los archivos de entrada protegidos con contraseña no son compatibles.
