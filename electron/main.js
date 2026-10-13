/**
 * Proceso principal de Electron: crea las ventanas (principal, "Acerca de" y splash), arranca y
 * detiene el backend Python como proceso hijo, y expone al renderer —a través de los handlers
 * IPC del final del archivo, consumidos desde `preload.js`/`about-preload.js`— todo lo que
 * necesita pero no puede hacer por sí mismo dentro del sandbox del renderer (diálogos nativos de
 * archivo, preferencias persistidas en disco, etc.).
 */
const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, nativeTheme } = require("electron");
const { autoUpdater } = require("electron-updater");
const { formatReleaseNotes } = require("./releaseNotes.js");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const packageJson = require("../package.json");

const isDev = process.env.NODE_ENV === "development";

/** @type {import('child_process').ChildProcess | null} */
let backendProcess = null;
let backendPort = null;
// Token secreto de esta ejecución: se pasa al backend por variable de entorno y al renderer por
// IPC (`get-backend-port`); el backend rechaza las peticiones que no lo traigan.
let backendToken = null;
let backendStartError = null;
let mainWindow = null;
let aboutWindow = null;
let splashWindow = null;
let currentLanguage = "es";

const INPUT_FORMATS = [{ name: "Hojas de cálculo soportadas", extensions: ["xlsx", "xls", "csv", "ods"] }];

const THEME_OPTIONS = ["system", "light", "dark"];

// `nativeTheme.themeSource` es la forma nativa de Electron de forzar claro/oscuro: al cambiarlo,
// Chromium reevalúa en caliente `prefers-color-scheme` en TODAS las ventanas abiertas (la
// principal y la de "Acerca de"), sin recargar nada — por eso ni styles.css ni about.css
// necesitan lógica de tema propia, ya usan `@media (prefers-color-scheme: dark)`. Electron no
// persiste este valor entre reinicios, así que lo guardamos nosotros en un archivo chico dentro
// de userData.
function themeConfigPath() {
  return path.join(app.getPath("userData"), "theme.json");
}

/** @returns {Promise<"system"|"light"|"dark">} el tema guardado, o `"system"` si no hay ninguno. */
async function loadThemePreference() {
  try {
    const raw = await fs.readFile(themeConfigPath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (THEME_OPTIONS.includes(parsed.theme)) return parsed.theme;
  } catch {
    // Primer arranque, o archivo inexistente/corrupto: usamos el valor por defecto.
  }
  return "system";
}

/** @param {"system"|"light"|"dark"} theme */
async function saveThemePreference(theme) {
  try {
    await fs.writeFile(themeConfigPath(), JSON.stringify({ theme }), "utf-8");
  } catch (err) {
    console.error("No se pudo guardar la preferencia de tema:", err);
  }
}

// Mismo patrón que el tema (ver arriba): se persiste en un archivo propio dentro de userData
// porque Electron no guarda esto entre reinicios. El renderer (i18next) es la única fuente de
// verdad de las traducciones; aquí solo se guarda el código de idioma elegido.
const SUPPORTED_LANGUAGES = ["es", "en", "de", "fr", "it", "pt", "ru", "zh"];

function languageConfigPath() {
  return path.join(app.getPath("userData"), "language.json");
}

/**
 * Si el usuario nunca eligió un idioma, se propone el de su sistema operativo (si está entre
 * los soportados) en vez de forzar español siempre.
 * @returns {string} código de idioma de dos letras (p. ej. `"en"`)
 */
function detectSystemLanguage() {
  const prefix = app.getLocale().split("-")[0].toLowerCase();
  return SUPPORTED_LANGUAGES.includes(prefix) ? prefix : "es";
}

/** @returns {Promise<string>} el idioma guardado, o el detectado del sistema si es la primera vez. */
async function loadLanguagePreference() {
  try {
    const raw = await fs.readFile(languageConfigPath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (SUPPORTED_LANGUAGES.includes(parsed.language)) return parsed.language;
  } catch {
    // Primer arranque, o archivo inexistente/corrupto: se detecta a partir del sistema.
  }
  return detectSystemLanguage();
}

/** @param {string} language uno de `SUPPORTED_LANGUAGES` */
async function saveLanguagePreference(language) {
  try {
    await fs.writeFile(languageConfigPath(), JSON.stringify({ language }), "utf-8");
  } catch (err) {
    console.error("No se pudo guardar la preferencia de idioma:", err);
  }
}

// Preferencias de la pantalla principal que se recuerdan entre sesiones (carpeta de destino,
// formato de salida, modo...). Mismo patrón que el idioma: un archivo propio en userData. Solo se
// aceptan estas claves y valores, para que un archivo editado a mano no pueda meter basura.
const PREFERENCE_VALIDATORS = {
  destinationFolder: (v) => typeof v === "string",
  outputFormat: (v) => ["xlsx", "xls", "csv", "ods"].includes(v),
  outputCsvSeparator: (v) => [",", ";"].includes(v),
  mode: (v) => ["concat", "join"].includes(v),
  joinType: (v) => ["inner", "left", "right", "outer"].includes(v),
};

function preferencesPath() {
  return path.join(app.getPath("userData"), "preferences.json");
}

/** Lee las preferencias guardadas, descartando claves desconocidas o con valores no válidos. */
async function loadPreferences() {
  let parsed = {};
  try {
    parsed = JSON.parse(await fs.readFile(preferencesPath(), "utf-8"));
  } catch {
    // Primer arranque, o archivo inexistente/corrupto: sin preferencias.
  }
  const preferences = {};
  for (const [key, isValid] of Object.entries(PREFERENCE_VALIDATORS)) {
    if (isValid(parsed?.[key])) preferences[key] = parsed[key];
  }
  return preferences;
}

// Textos del único diálogo nativo que muestra el proceso principal (fallo al arrancar el
// backend Python). Es el único texto de main.js que necesita traducción: todo lo demás vive en
// el renderer, donde ya está disponible el motor de i18n completo (i18next).
const STARTUP_ERROR_TEXT = {
  es: {
    whatsNew: "Novedades:",
    title: "Error al iniciar Merger Lab",
    intro: "No se pudo iniciar el proceso de combinación de archivos.",
    devHint:
      "Verifica que Python 3 esté instalado y accesible en el PATH, y que backend/requirements.txt esté instalado.",
    prodHint: "Reinstala la aplicación o contacta con soporte.",
  },
  en: {
    whatsNew: "What's new:",
    title: "Error starting Merger Lab",
    intro: "The file-merging process could not be started.",
    devHint:
      "Check that Python 3 is installed and available on PATH, and that backend/requirements.txt is installed.",
    prodHint: "Reinstall the application or contact support.",
  },
  de: {
    whatsNew: "Neuigkeiten:",
    title: "Fehler beim Starten von Merger Lab",
    intro: "Der Prozess zum Kombinieren der Dateien konnte nicht gestartet werden.",
    devHint:
      "Prüfe, ob Python 3 installiert und im PATH verfügbar ist und ob backend/requirements.txt installiert wurde.",
    prodHint: "Installiere die Anwendung neu oder wende dich an den Support.",
  },
  fr: {
    whatsNew: "Nouveautés :",
    title: "Erreur au démarrage de Merger Lab",
    intro: "Le processus de combinaison des fichiers n'a pas pu démarrer.",
    devHint:
      "Vérifiez que Python 3 est installé et accessible dans le PATH, et que backend/requirements.txt est installé.",
    prodHint: "Réinstallez l'application ou contactez le support.",
  },
  it: {
    whatsNew: "Novità:",
    title: "Errore durante l'avvio di Merger Lab",
    intro: "Non è stato possibile avviare il processo di combinazione dei file.",
    devHint:
      "Verifica che Python 3 sia installato e accessibile nel PATH e che backend/requirements.txt sia installato.",
    prodHint: "Reinstalla l'applicazione o contatta l'assistenza.",
  },
  pt: {
    whatsNew: "Novidades:",
    title: "Erro ao iniciar o Merger Lab",
    intro: "Não foi possível iniciar o processo de combinação de arquivos.",
    devHint:
      "Verifique se o Python 3 está instalado e acessível no PATH, e se backend/requirements.txt está instalado.",
    prodHint: "Reinstale a aplicação ou entre em contato com o suporte.",
  },
  ru: {
    whatsNew: "Что нового:",
    title: "Ошибка запуска Merger Lab",
    intro: "Не удалось запустить процесс объединения файлов.",
    devHint:
      "Убедитесь, что Python 3 установлен и доступен в PATH, и что backend/requirements.txt установлен.",
    prodHint: "Переустановите приложение или обратитесь в поддержку.",
  },
  zh: {
    whatsNew: "更新内容：",
    title: "启动 Merger Lab 时出错",
    intro: "无法启动文件合并进程。",
    devHint: "请检查是否已安装 Python 3 并在 PATH 中可用，以及是否已安装 backend/requirements.txt。",
    prodHint: "请重新安装应用程序，或联系支持人员。",
  },
};

/**
 * Muestra el diálogo nativo de error cuando el backend Python no llegó a arrancar, en el idioma
 * indicado (con `err.message`, que no se traduce: suele ser un error de sistema operativo o de
 * `child_process`, no un mensaje de `MergeError`).
 * @param {string} language
 * @param {Error} err
 */
function showBackendStartupError(language, err) {
  const text = STARTUP_ERROR_TEXT[language] || STARTUP_ERROR_TEXT.es;
  const hint = isDev ? text.devHint : text.prodHint;
  dialog.showErrorBox(text.title, `${text.intro}\n\n${err.message}\n\n${hint}`);
}

// Textos del diálogo de auto-actualización (electron-updater). Mismo motivo que
// STARTUP_ERROR_TEXT: es un diálogo nativo del proceso principal, sin acceso a i18next.
const UPDATE_DIALOG_TEXT = {
  es: {
    title: "Actualización disponible",
    body: (v) => `Hay una nueva versión de Merger Lab (${v}) lista para instalar.`,
    detail:
      "Al pulsar «Actualizar ahora», la app se cerrará, se actualizará y volverá a abrirse sola en unos segundos.",
    updateNow: "Actualizar ahora",
    later: "Más tarde",
  },
  en: {
    title: "Update available",
    body: (v) => `A new version of Merger Lab (${v}) is ready to install.`,
    detail:
      "Click “Update now” and the app will close, update itself and reopen on its own in a few seconds.",
    updateNow: "Update now",
    later: "Later",
  },
  de: {
    title: "Update verfügbar",
    body: (v) => `Eine neue Version von Merger Lab (${v}) ist bereit zur Installation.`,
    detail:
      "Klicken Sie auf „Jetzt aktualisieren“: Die App wird geschlossen, aktualisiert und öffnet sich nach wenigen Sekunden automatisch wieder.",
    updateNow: "Jetzt aktualisieren",
    later: "Später",
  },
  fr: {
    title: "Mise à jour disponible",
    body: (v) => `Une nouvelle version de Merger Lab (${v}) est prête à être installée.`,
    detail:
      "Cliquez sur « Mettre à jour » : l'application se fermera, se mettra à jour et se rouvrira toute seule en quelques secondes.",
    updateNow: "Mettre à jour",
    later: "Plus tard",
  },
  it: {
    title: "Aggiornamento disponibile",
    body: (v) => `Una nuova versione di Merger Lab (${v}) è pronta per essere installata.`,
    detail:
      "Fai clic su «Aggiorna ora»: l'app si chiuderà, si aggiornerà e si riaprirà da sola in pochi secondi.",
    updateNow: "Aggiorna ora",
    later: "Più tardi",
  },
  pt: {
    title: "Atualização disponível",
    body: (v) => `Uma nova versão do Merger Lab (${v}) está pronta para ser instalada.`,
    detail:
      "Clique em “Atualizar agora”: o app será fechado, atualizado e reaberto sozinho em alguns segundos.",
    updateNow: "Atualizar agora",
    later: "Mais tarde",
  },
  ru: {
    title: "Доступно обновление",
    body: (v) => `Новая версия Merger Lab (${v}) готова к установке.`,
    detail:
      "Нажмите «Обновить сейчас»: приложение закроется, обновится и через несколько секунд снова откроется само.",
    updateNow: "Обновить сейчас",
    later: "Позже",
  },
  zh: {
    title: "有可用更新",
    body: (v) => `Merger Lab 新版本（${v}）已准备好安装。`,
    detail: "点击“立即更新”后，应用将关闭、自动完成更新，并在几秒钟后自动重新打开。",
    updateNow: "立即更新",
    later: "以后再说",
  },
};

// Textos del diálogo de confirmación al sobrescribir el archivo de salida (diálogo nativo,
// mismo motivo que UPDATE_DIALOG_TEXT). `{n}` se sustituye por el nombre del archivo.
const OVERWRITE_DIALOG_TEXT = {
  es: {
    title: "Archivo existente",
    message: "Ya existe «{n}» en la carpeta de destino.",
    detail: "Si continúas, se reemplazará su contenido.",
    replace: "Reemplazar",
    cancel: "Cancelar",
  },
  en: {
    title: "File already exists",
    message: "“{n}” already exists in the destination folder.",
    detail: "If you continue, its contents will be replaced.",
    replace: "Replace",
    cancel: "Cancel",
  },
  de: {
    title: "Datei vorhanden",
    message: "„{n}“ existiert bereits im Zielordner.",
    detail: "Wenn Sie fortfahren, wird der Inhalt ersetzt.",
    replace: "Ersetzen",
    cancel: "Abbrechen",
  },
  fr: {
    title: "Fichier existant",
    message: "« {n} » existe déjà dans le dossier de destination.",
    detail: "Si vous continuez, son contenu sera remplacé.",
    replace: "Remplacer",
    cancel: "Annuler",
  },
  it: {
    title: "File esistente",
    message: "«{n}» esiste già nella cartella di destinazione.",
    detail: "Se continui, il contenuto verrà sostituito.",
    replace: "Sostituisci",
    cancel: "Annulla",
  },
  pt: {
    title: "Arquivo existente",
    message: "“{n}” já existe na pasta de destino.",
    detail: "Se continuar, o conteúdo será substituído.",
    replace: "Substituir",
    cancel: "Cancelar",
  },
  ru: {
    title: "Файл уже существует",
    message: "Файл «{n}» уже есть в папке назначения.",
    detail: "Если продолжить, его содержимое будет заменено.",
    replace: "Заменить",
    cancel: "Отмена",
  },
  zh: {
    title: "文件已存在",
    message: "目标文件夹中已存在“{n}”。",
    detail: "继续将替换其内容。",
    replace: "替换",
    cancel: "取消",
  },
};

/**
 * Configura la comprobación automática de actualizaciones (electron-updater, contra GitHub
 * Releases del propio repo -- ver `publish` en electron-builder.yml). Se llama una vez al
 * arrancar, en segundo plano: no bloquea ni retrasa la ventana principal.
 *
 * No hace nada si la app corre en modo desarrollo (no hay nada publicado que comprobar) ni si
 * corre como versión portable: el portable no tiene una carpeta de instalación fija donde
 * aplicar la actualización in situ (ver el comentario de `useZip` en electron-builder.yml), así
 * que actualizarlo automáticamente no es viable -- el usuario del portable simplemente descarga
 * el .exe nuevo cuando quiera.
 */
function setupAutoUpdater() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;

  autoUpdater.autoDownload = true;
  // Preferimos preguntar explícitamente al usuario (ver "update-downloaded" abajo) en vez de
  // instalar sin avisar la próxima vez que cierre la app.
  autoUpdater.autoInstallOnAppQuit = false;
  // Con esto `info.releaseNotes` trae las notas de todas las versiones intermedias (no solo la
  // última), por si el usuario salta varias versiones de golpe.
  autoUpdater.fullChangelog = true;

  autoUpdater.on("error", (err) => {
    // Un fallo comprobando actualizaciones (sin conexión, GitHub caído, etc.) no debe
    // interrumpir el uso normal de la app: solo se registra en consola.
    console.error("Error comprobando actualizaciones:", err);
  });

  autoUpdater.on("update-downloaded", (info) => {
    // Se lee `currentLanguage` aquí (no al arrancar): el usuario pudo cambiar de idioma después.
    const text = UPDATE_DIALOG_TEXT[currentLanguage] || UPDATE_DIALOG_TEXT.es;
    const notes = formatReleaseNotes(info.releaseNotes, currentLanguage);
    dialog
      .showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
        type: "info",
        title: text.title,
        message: text.body(info.version),
        detail: notes ? [text.whatsNew, notes, "", text.detail].join("\n") : text.detail,
        buttons: [text.updateNow, text.later],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        // isSilent=true: el instalador NSIS es asistido (oneClick: false en
        // electron-builder.yml), así que sin esto mostraría su asistente y el usuario tendría
        // que pulsar "Finalizar". En silencio instala sobre la carpeta ya existente sin
        // preguntar nada. isForceRunAfter=true: vuelve a abrir la app al terminar.
        if (response === 0) autoUpdater.quitAndInstall(true, true);
      });
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error("No se pudo comprobar si hay actualizaciones:", err);
  });
}

// En dev, el servidor de Vite inyecta un script inline (React Fast Refresh) y usa un
// websocket para HMR; la CSP de producción (pensada para file://) los bloquea, dejando
// la ventana en blanco. Por eso la política se define acá (no en un <meta> del HTML) y
// varía según el entorno.
const DEV_CSP =
  "default-src 'self' http://localhost:5173; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; " +
  "style-src 'self' 'unsafe-inline' http://localhost:5173; " +
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://localhost:*; " +
  "img-src 'self' data: http://localhost:5173;";

const PROD_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' http://127.0.0.1:*; " +
  "img-src 'self' data:;";

/** Instala la Content-Security-Policy adecuada al entorno en todas las respuestas del renderer. */
function applyContentSecurityPolicy() {
  const csp = isDev ? DEV_CSP : PROD_CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

/**
 * Determina el comando para lanzar el backend: en desarrollo, el intérprete de Python sobre
 * `backend/server.py`; en producción, el ejecutable de PyInstaller empaquetado como recurso
 * extra (ver `extraResources` en `electron-builder.yml`).
 * @returns {{command: string, args: string[]}}
 */
function resolveBackendCommand() {
  if (isDev) {
    const script = path.join(__dirname, "..", "backend", "server.py");
    const pythonBin = process.platform === "win32" ? "python" : "python3";
    return { command: pythonBin, args: [script] };
  }

  // PyInstaller en modo --onedir coloca el ejecutable dentro de una subcarpeta con su
  // propio nombre (junto a _internal/), en vez de un único binario autoextraible.
  const backendDir = path.join(process.resourcesPath, "backend", "merger-backend");
  const exeName = process.platform === "win32" ? "merger-backend.exe" : "merger-backend";
  return { command: path.join(backendDir, exeName), args: [] };
}

/**
 * Lanza el proceso backend y espera a que anuncie su puerto por stdout (línea `PORT:<numero>`).
 * @returns {Promise<number>} el puerto en el que quedó escuchando el backend
 */
function startBackend() {
  return new Promise((resolve, reject) => {
    const { command, args } = resolveBackendCommand();
    let settled = false;

    try {
      backendToken = crypto.randomBytes(32).toString("hex");
      backendProcess = spawn(command, args, {
        cwd: path.dirname(command),
        windowsHide: true,
        env: { ...process.env, MERGERLAB_TOKEN: backendToken },
      });
    } catch (err) {
      reject(err);
      return;
    }

    const stdoutReader = readline.createInterface({ input: backendProcess.stdout });
    stdoutReader.on("line", (line) => {
      const match = line.match(/^PORT:(\d+)$/);
      if (match) {
        backendPort = Number(match[1]);
        if (!settled) {
          settled = true;
          resolve(backendPort);
        }
      } else {
        console.log(`[backend] ${line}`);
      }
    });

    backendProcess.stderr.on("data", (data) => {
      console.error(`[backend:err] ${data.toString()}`);
    });

    backendProcess.on("error", (err) => {
      backendStartError = err;
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    backendProcess.on("exit", (code, signal) => {
      console.log(`[backend] proceso finalizado (code=${code}, signal=${signal})`);
      backendProcess = null;
      if (!settled) {
        settled = true;
        reject(new Error(`El backend terminó antes de iniciar (code=${code})`));
      } else if (mainWindow && !app.isQuitting) {
        // Se envía un código, no un texto: el renderer ya tiene el motor de i18n completo
        // (i18next) y sabe traducirlo; aquí solo hace falta identificar de qué error se trata.
        mainWindow.webContents.send("backend-error", "backend_crashed");
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Tiempo de espera agotado iniciando el backend."));
      }
    }, 15000);
  });
}

/** Mata el proceso backend si sigue vivo (se llama al cerrar la app, ver `before-quit`). */
function stopBackend() {
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch (err) {
      console.error("Error al detener el backend:", err);
    }
    backendProcess = null;
  }
}

// En Windows/Linux se quita del todo la barra de menú (File/Edit/View...). En macOS se deja un
// menú mínimo (solo el ítem de la app + Editar) porque, a diferencia de Windows, ahí el menú vive
// en la barra superior del sistema (no dentro de la ventana) y sin el rol "editMenu" se rompen los
// atajos de teclado de portapapeles (Cmd+C/V/X/A) en los campos de texto.
function configureApplicationMenu() {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

// Ventana ligera y sin marco que se muestra de inmediato al arrancar, mientras el backend
// Python arranca y la ventana principal carga su primer frame. Es HTML estático (no pasa por
// Vite) para poder mostrarla antes de que exista nada más listo.
/**
 * @param {string} language idioma ya resuelto (persistido o detectado del sistema)
 * @returns {BrowserWindow}
 */
function createSplashWindow(language) {
  const splash = new BrowserWindow({
    width: 320,
    height: 300,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#14161a" : "#f4f5f7",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // splash.html es HTML estático (no pasa por Vite/i18next); recibe el idioma por query string
  // y trae su propio diccionario mínimo embebido para el único texto que muestra.
  splash.loadFile(path.join(__dirname, "splash.html"), { query: { lang: language } });
  splash.on("closed", () => {
    splashWindow = null;
  });
  return splash;
}

/** Crea la ventana principal y espera a que termine de cargar (React montado y visible). */
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 820,
    minHeight: 600,
    title: "Merger Lab",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Hasta que el renderer no pinta su primer frame no cerramos el splash ni mostramos la
  // ventana principal: evita el parpadeo de una ventana en blanco antes de que React monte.
  mainWindow.once("ready-to-show", () => {
    if (splashWindow) {
      splashWindow.close();
    }
    mainWindow.show();
  });

  if (isDev) {
    await mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/** Abre la ventana modal "Acerca de" (o la enfoca si ya está abierta). No hace nada sin `mainWindow`. */
function openAboutWindow() {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }
  if (!mainWindow) return;

  const width = 360;
  const height = 510;
  const parentBounds = mainWindow.getBounds();
  const x = Math.round(parentBounds.x + (parentBounds.width - width) / 2);
  const y = Math.round(parentBounds.y + (parentBounds.height - height) / 2);

  aboutWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    parent: mainWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: "Acerca de Merger Lab",
    webPreferences: {
      preload: path.join(__dirname, "about-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  aboutWindow.setMenuBarVisibility(false);

  if (isDev) {
    aboutWindow.loadURL("http://localhost:5173/src/about.html");
  } else {
    aboutWindow.loadFile(path.join(__dirname, "..", "dist", "src", "about.html"));
  }

  aboutWindow.on("closed", () => {
    aboutWindow = null;
  });
}

app.whenReady().then(async () => {
  applyContentSecurityPolicy();
  configureApplicationMenu();
  nativeTheme.themeSource = await loadThemePreference();
  currentLanguage = await loadLanguagePreference();

  splashWindow = createSplashWindow(currentLanguage);

  let backendStartFailure = null;
  try {
    await startBackend();
  } catch (err) {
    backendStartFailure = err;
    console.error("No se pudo iniciar el backend Python:", err);
  }

  await createWindow();

  // El diálogo se muestra tras crear la ventana principal (y no antes, junto al splash) para
  // que no quede huérfano sin ninguna ventana de la app detrás.
  if (backendStartFailure) {
    showBackendStartupError(currentLanguage, backendStartFailure);
  }

  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopBackend();
});

// ---- IPC handlers ----
// Cada uno corresponde a un método de `window.electronAPI` (ver electron/preload.js) que llama
// el renderer. Los que abren diálogos nativos reciben `mainWindow` implícitamente para que el
// diálogo quede anclado a la ventana principal (modal respecto a ella).

/** Puerto del backend y, si no llegó a arrancar, el motivo (ver `src/api.js::getApiBase`). */
ipcMain.handle("get-backend-port", () => {
  return {
    port: backendPort,
    token: backendToken,
    error: backendStartError ? backendStartError.message : null,
  };
});

/** Diálogo nativo para elegir uno o varios archivos de entrada. */
ipcMain.handle("select-input-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Seleccionar archivos a combinar",
    properties: ["openFile", "multiSelections"],
    filters: INPUT_FORMATS,
  });

  if (result.canceled) {
    return { canceled: true, files: [] };
  }

  return { canceled: false, files: result.filePaths };
});

/**
 * Preferencias recordadas. La carpeta de destino solo se devuelve si todavía existe (puede
 * haberse borrado o ser de un disco desconectado).
 */
ipcMain.handle("get-preferences", async () => {
  const preferences = await loadPreferences();
  if (preferences.destinationFolder) {
    try {
      const stats = await fs.stat(preferences.destinationFolder);
      if (!stats.isDirectory()) delete preferences.destinationFolder;
    } catch {
      delete preferences.destinationFolder;
    }
  }
  return preferences;
});

/** Guarda (fusionando con lo anterior) las preferencias válidas de `partial`. */
ipcMain.handle("set-preferences", async (_event, partial) => {
  const updates = {};
  for (const [key, isValid] of Object.entries(PREFERENCE_VALIDATORS)) {
    if (isValid(partial?.[key])) updates[key] = partial[key];
  }
  try {
    const merged = { ...(await loadPreferences()), ...updates };
    await fs.writeFile(preferencesPath(), JSON.stringify(merged), "utf-8");
  } catch (err) {
    console.error("No se pudieron guardar las preferencias:", err);
  }
});

/**
 * Si `filePath` ya existe, pregunta con un diálogo nativo si se puede reemplazar.
 * @returns {Promise<boolean>} `true` si se puede escribir (no existía o el usuario aceptó)
 */
ipcMain.handle("confirm-overwrite", async (_event, filePath) => {
  try {
    await fs.access(filePath);
  } catch {
    return true;
  }
  const text = OVERWRITE_DIALOG_TEXT[currentLanguage] || OVERWRITE_DIALOG_TEXT.es;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: text.title,
    message: text.message.replace("{n}", path.basename(filePath)),
    detail: text.detail,
    buttons: [text.replace, text.cancel],
    defaultId: 1,
    cancelId: 1,
  });
  return response === 0;
});

/** Diálogo nativo para elegir la carpeta de destino del archivo combinado. */
ipcMain.handle("select-output-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Seleccionar carpeta de destino",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, path: null };
  }

  return { canceled: false, path: result.filePaths[0] };
});

/**
 * Tamaño en bytes de cada ruta (el renderer no puede leer el sistema de archivos directamente,
 * `nodeIntegration` está desactivado). Si una ruta falla (p. ej. se borró el archivo), devuelve
 * tamaño 0 para esa entrada en vez de cortar la petición entera.
 */
ipcMain.handle("stat-files", async (_event, filePaths) => {
  const entries = await Promise.all(
    (filePaths || []).map(async (filePath) => {
      try {
        const stats = await fs.stat(filePath);
        return { path: filePath, size: stats.size };
      } catch {
        return { path: filePath, size: 0 };
      }
    })
  );
  return entries;
});

/** Abre el explorador de archivos del SO con `filePath` seleccionado (botón "Abrir carpeta"). */
ipcMain.handle("open-containing-folder", async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle("open-about-window", () => {
  openAboutWindow();
});

/** Cierra la ventana que invoca este canal (lo usa la propia ventana "Acerca de" sobre sí misma). */
ipcMain.handle("close-about-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

ipcMain.handle("get-theme", () => nativeTheme.themeSource);

/** Cambia y persiste el tema; ignora valores fuera de `THEME_OPTIONS`. */
ipcMain.handle("set-theme", async (_event, theme) => {
  if (!THEME_OPTIONS.includes(theme)) return nativeTheme.themeSource;
  nativeTheme.themeSource = theme;
  await saveThemePreference(theme);
  return nativeTheme.themeSource;
});

ipcMain.handle("get-language", () => currentLanguage);

/** Cambia y persiste el idioma; ignora valores fuera de `SUPPORTED_LANGUAGES`. */
ipcMain.handle("set-language", async (_event, language) => {
  if (!SUPPORTED_LANGUAGES.includes(language)) return currentLanguage;
  currentLanguage = language;
  await saveLanguagePreference(language);
  return currentLanguage;
});

ipcMain.handle("replay-onboarding", () => {
  // La ventana "Acerca de" es modal sobre la principal: la cerramos para que no tape el
  // recorrido, que resalta elementos de la ventana principal.
  aboutWindow?.close();
  mainWindow?.webContents.send("replay-onboarding");
  mainWindow?.focus();
});

/** Datos de `package.json` que muestra la ventana "Acerca de" (nombre, versión, autor, etc.). */
ipcMain.handle("get-app-info", () => {
  const author = packageJson.author;
  return {
    name: packageJson.productName || packageJson.name,
    version: app.getVersion(),
    description: packageJson.description || "",
    author: typeof author === "string" ? author : author?.name || "",
    authorUrl: typeof author === "object" ? author?.url || "" : "",
    license: packageJson.license || "",
    year: String(new Date().getFullYear()),
    repository:
      typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url || "",
  };
});

/** Abre `url` en el navegador del SO, solo si es `https://` (evita `file://`/`javascript:` desde el renderer). */
ipcMain.handle("open-external", (_event, url) => {
  if (typeof url === "string" && /^https:\/\//.test(url)) {
    shell.openExternal(url);
  }
});
