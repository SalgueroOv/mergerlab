/**
 * Preload de la ventana "Acerca de": expone `window.aboutAPI`, el equivalente de
 * `electron/preload.js` pero acotado a lo que necesita esa ventana (ver `src/about.js`).
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aboutAPI", {
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  closeWindow: () => ipcRenderer.invoke("close-about-window"),
  replayOnboarding: () => ipcRenderer.invoke("replay-onboarding"),
  getLanguage: () => ipcRenderer.invoke("get-language"),
});
