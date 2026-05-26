const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("cogninode", {
  platform: process.platform,
  isElectron: true,
});
