const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const packageJson = require("../package.json");

const isDev = process.env.NODE_ENV === "development";

/** @type {import('child_process').ChildProcess | null} */
let backendProcess = null;
let backendPort = null;
let backendStartError = null;
let mainWindow = null;
let aboutWindow = null;

const INPUT_FORMATS = [
  { name: "Hojas de cálculo soportadas", extensions: ["xlsx", "xls", "csv", "ods"] },
];

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

async function saveThemePreference(theme) {
  try {
    await fs.writeFile(themeConfigPath(), JSON.stringify({ theme }), "utf-8");
  } catch (err) {
    console.error("No se pudo guardar la preferencia de tema:", err);
  }
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

function resolveBackendCommand() {
  if (isDev) {
    const script = path.join(__dirname, "..", "backend", "server.py");
    const pythonBin = process.platform === "win32" ? "python" : "python3";
    return { command: pythonBin, args: [script] };
  }

  const backendDir = path.join(process.resourcesPath, "backend");
  const exeName = process.platform === "win32" ? "merger-backend.exe" : "merger-backend";
  return { command: path.join(backendDir, exeName), args: [] };
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const { command, args } = resolveBackendCommand();
    let settled = false;

    try {
      backendProcess = spawn(command, args, {
        cwd: path.dirname(command),
        windowsHide: true,
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
        mainWindow.webContents.send(
          "backend-error",
          "El proceso de backend se detuvo inesperadamente. Reinicia la aplicación."
        );
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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: "Merger Lab",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

  try {
    await startBackend();
  } catch (err) {
    console.error("No se pudo iniciar el backend Python:", err);
    dialog.showErrorBox(
      "Error al iniciar Merger Lab",
      `No se pudo iniciar el proceso de combinación de archivos.\n\n${err.message}\n\n` +
        (isDev
          ? "Verifica que Python 3 esté instalado y accesible en el PATH, y que backend/requirements.txt esté instalado."
          : "Reinstala la aplicación o contacta con soporte.")
    );
  }

  await createWindow();

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

ipcMain.handle("get-backend-port", () => {
  return { port: backendPort, error: backendStartError ? backendStartError.message : null };
});

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

ipcMain.handle("open-containing-folder", async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle("open-about-window", () => {
  openAboutWindow();
});

ipcMain.handle("close-about-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

ipcMain.handle("get-theme", () => nativeTheme.themeSource);

ipcMain.handle("set-theme", async (_event, theme) => {
  if (!THEME_OPTIONS.includes(theme)) return nativeTheme.themeSource;
  nativeTheme.themeSource = theme;
  await saveThemePreference(theme);
  return nativeTheme.themeSource;
});

ipcMain.handle("replay-onboarding", () => {
  // La ventana "Acerca de" es modal sobre la principal: la cerramos para que no tape el
  // recorrido, que resalta elementos de la ventana principal.
  aboutWindow?.close();
  mainWindow?.webContents.send("replay-onboarding");
  mainWindow?.focus();
});

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
      typeof packageJson.repository === "string"
        ? packageJson.repository
        : packageJson.repository?.url || "",
  };
});

ipcMain.handle("open-external", (_event, url) => {
  if (typeof url === "string" && /^https:\/\//.test(url)) {
    shell.openExternal(url);
  }
});
