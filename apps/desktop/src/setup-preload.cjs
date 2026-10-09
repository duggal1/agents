const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoSetup", {
  platform: process.platform,
  state: () => ipcRenderer.invoke("desktop.setup.state"),
  test: (url) => ipcRenderer.invoke("desktop.setup.test", url),
  save: (setup) => ipcRenderer.invoke("desktop.setup.save", setup),
  quit: () => ipcRenderer.invoke("desktop.setup.quit"),
  // Optional E2B key entry for the This-computer path (Stream B / T5 owns the
  // main-process handlers and secure storage). Key material never touches
  // renderer storage; only ok/error shapes and status booleans come back.
  runtime: {
    status: () => ipcRenderer.invoke("desktop.setup.runtime.status"),
    setKey: (key) => ipcRenderer.invoke("desktop.setup.runtime.setKey", key),
  },
  stack: {
    state: () => ipcRenderer.invoke("desktop.setup.stack.state"),
    // Options are narrowed in the main process: only `{ fresh?: boolean }` has
    // any effect. Paths, ports, and environment are never accepted.
    start: (options) => ipcRenderer.invoke("desktop.setup.stack.start", options),
    stop: () => ipcRenderer.invoke("desktop.setup.stack.stop"),
    onChange: (listener) => {
      ipcRenderer.on("desktop.setup.stack.changed", (_event, state) => listener(state));
    },
  },
});
