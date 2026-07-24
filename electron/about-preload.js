const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aboutAPI", {
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  closeWindow: () => ipcRenderer.invoke("close-about-window"),
  replayOnboarding: () => ipcRenderer.invoke("replay-onboarding"),
  getLanguage: () => ipcRenderer.invoke("get-language"),
});
