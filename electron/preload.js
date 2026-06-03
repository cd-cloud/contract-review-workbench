/**
 * Electron preload script — exposes safe APIs to the renderer process.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  getPaths: () => ipcRenderer.invoke("app:get-paths"),
  openFolder: (folderPath) => ipcRenderer.invoke("app:open-folder", folderPath),
  showSaveDialog: (options) => ipcRenderer.invoke("app:show-save-dialog", options),
  showOpenDialog: (options) => ipcRenderer.invoke("app:show-open-dialog", options),
});
