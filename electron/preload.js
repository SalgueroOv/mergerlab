const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectInputFiles: () => ipcRenderer.invoke("select-input-files"),
  selectOutputFolder: () => ipcRenderer.invoke("select-output-folder"),
  statFiles: (paths) => ipcRenderer.invoke("stat-files", paths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getBackendPort: () => ipcRenderer.invoke("get-backend-port"),
  openContainingFolder: (filePath) => ipcRenderer.invoke("open-containing-folder", filePath),
  openAboutWindow: () => ipcRenderer.invoke("open-about-window"),
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
  getLanguage: () => ipcRenderer.invoke("get-language"),
  setLanguage: (language) => ipcRenderer.invoke("set-language", language),
});
