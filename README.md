# Merger Lab

[![CI](https://github.com/SalgueroOv/mergelab/actions/workflows/ci.yml/badge.svg)](https://github.com/SalgueroOv/mergelab/actions/workflows/ci.yml)

Aplicación de escritorio multiplataforma (Windows, macOS, Linux) para combinar múltiples
archivos de hoja de cálculo (`.xls`, `.xlsx`, `.csv`, `.ods`) en un único archivo de salida,
en cualquiera de esos mismos formatos.

## Arquitectura

- **UI**: Electron + React (Vite).
- **Backend**: Python (pandas, openpyxl, xlrd, odfpy, xlwt) empaquetado con PyInstaller en modo
  `--onedir`. Se ejecuta como proceso independiente que Electron lanza al arrancar. Se usa
  `--onedir` en vez de `--onefile` para evitar que el ejecutable se autoextraiga a una carpeta
  temporal en cada arranque (eso añadía varios segundos de arranque, sobre todo en la versión
  portable, que ya de por sí se autoextrae una vez al lanzarse).
- **Comunicación UI ↔ Backend**: HTTP local. El backend elige un puerto libre en `127.0.0.1`,
  lo imprime por stdout (`PORT:<numero>`) y Electron lo reenvía al renderer vía IPC. El
  renderer hace `fetch` directamente contra `http://127.0.0.1:<puerto>` para iniciar la
  combinación y sondear el progreso.
- **Empaquetado**: electron-builder genera instalador NSIS (sin requerir permisos de
  administrador) + versión portable para Windows, `.dmg` para macOS y `.AppImage` para Linux.
  El ejecutable de PyInstaller se incluye como recurso extra (`extraResources`) dentro del
  paquete de Electron, fuera del asar. El target `portable` de Windows usa `useZip: true`
  (`electron-builder.yml`) para que la autoextracción a una carpeta temporal, que ocurre en
  cada arranque de ese formato, use compresión zip (más rápida de descomprimir) en vez de
  7z/LZMA; el instalador NSIS no se ve afectado porque solo extrae una vez, al instalar.

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

## Calidad de código

- **JS/JSX** (`eslint.config.mjs` + `.prettierrc.json`):

  ```bash
  npm run lint          # ESLint
  npm run lint:fix      # ESLint con autofix
  npm run format        # Prettier, aplica formato
  npm run format:check  # Prettier, solo verifica
  ```

- **Python** (`pyproject.toml`, sección `[tool.ruff]`) — con el entorno virtual activado:

  ```bash
  pip install -r backend/requirements-dev.txt   # instala Ruff y pytest (solo la primera vez)
  ruff check backend/                           # lint
  ruff format backend/                          # formato
  ```

Los cuatro comandos anteriores (`lint`, `format:check`, `ruff check`, `ruff format --check`) más
`pytest backend/tests` se ejecutan automáticamente en cada push/Pull Request via GitHub Actions
(`.github/workflows/ci.yml`) — no hace falta correrlos a mano antes de subir, pero conviene
hacerlo igual para no esperar al resultado de CI.

## Tests

Por ahora solo hay tests del backend (`backend/tests/test_merger.py`, con `pytest`): cubren
`merge_files`/`join_files`/`write_output` y sobre todo los casos límite del join (columnas
duplicadas entre archivos, clave con nombres distintos, tipos mixtos en la columna clave) y que
cada error lance el `code` correcto (de eso depende que el frontend lo traduzca bien — ver
`src/i18n/backendMessages.js`). No hay tests del frontend ni de Electron todavía.

```bash
# con el entorno virtual activado y backend/requirements-dev.txt instalado
pytest backend/tests
```

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
pyinstaller backend/server.py --name merger-backend --onedir \
  --distpath resources/backend --workpath build/pyi-work --specpath build \
  --collect-submodules odf --noconfirm

# 2) Compilar frontend
npm run build:frontend

# 3) Generar distribuibles
npx electron-builder                 # todos los targets configurados para el SO actual
npm run dist:win                     # solo Windows (nsis + portable)
npm run dist:mac                     # solo macOS (dmg + zip)
npm run dist:linux                   # solo Linux (AppImage)
```

## Auto-actualización

La app comprueba en segundo plano, al arrancar (solo en la versión instalada, no en el
portable), si hay una versión más nueva publicada como GitHub Release del propio repo
(`electron-updater`, ver `setupAutoUpdater` en `electron/main.js` y `publish` en
`electron-builder.yml`). Si la hay, la descarga sola y, cuando termina, pregunta si reiniciar
para instalarla ("Reiniciar ahora" / "Más tarde") — nunca la instala sin avisar.

- El **portable no se autoactualiza**: no tiene una carpeta de instalación fija donde aplicar el
  update in situ, así que sus usuarios simplemente descargan el `.exe` nuevo cuando quieran.
- En **macOS sin firma de código**, el auto-update puede fallar al aplicar la actualización
  descargada (Gatekeeper). Sin certificado de desarrollador de Apple no hay forma de evitarlo.

### Publicar una versión

1. Sube la versión en `package.json` (campo `"version"`).
2. Genera un [token personal de GitHub](https://github.com/settings/tokens) con permiso
   `repo` (solo hace falta una vez; guárdalo en un sitio seguro, no en el repo).
3. Compila y publica (sustituye `dist:win` por `dist:mac`/`dist:linux` según el SO):

   ```bash
   # PowerShell
   $env:GH_TOKEN = "tu_token"
   npm run dist:win -- --publish always

   # bash
   GH_TOKEN=tu_token npm run dist:win -- --publish always
   ```

   Esto sube los instaladores como GitHub Release (borrador si la versión aún no existía) y
   genera los archivos `latest.yml`/`latest-mac.yml`/`latest-linux.yml` que usa
   `electron-updater` para detectar la versión nueva. Repite el paso para cada sistema operativo
   en el que quieras publicar (no se puede compilar macOS/Linux desde Windows, ver nota más
   arriba sobre compilación cruzada).

4. Publica el Release en GitHub (si `electron-builder` lo dejó como borrador).

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
  - Para agregar/editar pasos: modificar el arreglo `STEP_DEFS` en
    `src/components/OnboardingTour.jsx` (cada paso es `{ selector, titleKey, bodyKey }`, donde
    `selector` es cualquier selector CSS de un elemento ya presente en el DOM y
    `titleKey`/`bodyKey` son claves de `tour.steps.*` en `src/i18n/locales/*.json` — ver
    "Idiomas" más abajo).

## Idiomas

La app está traducida a español, inglés, alemán, francés, italiano, portugués, ruso y chino
simplificado (`src/i18n/locales/*.json`, usando [i18next](https://www.i18next.com) +
`react-i18next`). El selector de idioma está en el header (`LanguageToggle.jsx`); la elección se
persiste igual que el tema, en `app.getPath("userData")/language.json` (ver
`loadLanguagePreference`/`saveLanguagePreference` en `electron/main.js`). La primera vez que se
abre la app se propone el idioma del sistema operativo si está entre los soportados
(`detectSystemLanguage`), y si no, español.

- **Añadir un idioma nuevo**: crear `src/i18n/locales/<código>.json` con las mismas claves que
  `es.json` (es la referencia canónica), añadirlo a `resources` en `src/i18n/index.js` y a
  `SUPPORTED_LANGUAGES` ahí mismo — y también a `SUPPORTED_LANGUAGES` en `electron/main.js`
  (son dos listas independientes a propósito: una la usa el proceso principal de Electron, que
  no puede importar módulos del renderer). También hay que añadir su nombre nativo a
  `LANGUAGE_NAMES` (`src/i18n/index.js`) y su texto de carga a `LOADING_TEXT`
  (`electron/splash.js`, la pantalla de carga es HTML estático y no pasa por i18next).
- **Mensajes del backend Python** (errores y progreso de la combinación): `backend/merger.py` y
  `backend/server.py` mandan cada mensaje como `{ message, code, params }` — `message` es el
  texto en español de siempre (respaldo si el código no se reconoce, o si no es traducible
  porque incluye texto crudo de una excepción de terceros), y `code`/`params` se traducen en el
  frontend contra el namespace `backend.*` de los locales (`src/i18n/backendMessages.js`). Todo
  código nuevo en el backend necesita su traducción correspondiente en las 8 traducciones.
- **Ventana "Acerca de"** (`src/about.html`/`about.js`) y la **pantalla de carga**
  (`electron/splash.html`/`splash.js`) son procesos de renderer separados de la ventana
  principal: no comparten memoria ni la instancia de i18next, por eso `about.js` inicializa la
  suya propia (`src/aboutI18n.js`) y `splash.js` usa un diccionario mínimo aparte.
- Las traducciones a inglés/alemán/francés/italiano/portugués/ruso/chino se hicieron con
  asistencia de IA y no fueron revisadas por hablantes nativos; conviene una revisión antes de
  usarlas en un contexto profesional o legal.

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
