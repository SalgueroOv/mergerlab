/**
 * Preload de la ventana principal: expone en `window.electronAPI` (vía `contextBridge`, con
 * `contextIsolation`/`sandbox` activados) el único punto de contacto que tiene el renderer con
 * Node/Electron. Cada método delega en un canal `ipcMain.handle(...)` de `electron/main.js`
 * (mismo nombre de canal que la cadena literal usada aquí) o, en el caso de `getPathForFile`,
 * en la API `webUtils` directamente.
 */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectInputFiles: () => ipcRenderer.invoke("select-input-files"),
  selectOutputFolder: () => ipcRenderer.invoke("select-output-folder"),
  statFiles: (paths) => ipcRenderer.invoke("stat-files", paths),
  // Los objetos File que da el navegador no traen ruta absoluta; webUtils sí puede recuperarla
  // (lo usa FileList.jsx al soltar archivos por drag & drop).
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getBackendPort: () => ipcRenderer.invoke("get-backend-port"),
  confirmOverwrite: (filePath) => ipcRenderer.invoke("confirm-overwrite", filePath),
  openContainingFolder: (filePath) => ipcRenderer.invoke("open-containing-folder", filePath),
  openAboutWindow: () => ipcRenderer.invoke("open-about-window"),
  // onBackendError/onReplayOnboarding son eventos que empuja el proceso principal (no los pide
  // el renderer): se suscriben con ipcRenderer.on y devuelven una función para desuscribirse,
  // pensada para limpiarse en el cleanup de un useEffect.
  onBackendError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("backend-error", listener);
    return () => ipcRenderer.removeListener("backend-error", listener);
  },
  onReplayOnboarding: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("replay-onboarding", listener);
    return () => ipcRenderer.removeListener("replay-onboarding", listener);
  },
  getTheme: () => ipcRenderer.invoke("get-theme"),
  setTheme: (theme) => ipcRenderer.invoke("set-theme", theme),
  getPreferences: () => ipcRenderer.invoke("get-preferences"),
  setPreferences: (preferences) => ipcRenderer.invoke("set-preferences", preferences),
  getLanguage: () => ipcRenderer.invoke("get-language"),
  setLanguage: (language) => ipcRenderer.invoke("set-language", language),
});
