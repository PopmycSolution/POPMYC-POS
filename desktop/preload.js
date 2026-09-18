/**
 * POPMYC POS Desktop — Electron Preload Script
 * =============================================
 * Exposes a minimal, safe API to the React application via contextBridge.
 * The renderer process cannot access Node.js or Electron APIs directly.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popmycDesktop', {
  // ── App info ────────────────────────────────────────────────────────────────
  isDesktop:    true,
  getVersion:   () => ipcRenderer.invoke('app:getVersion'),
  getDataDir:   () => ipcRenderer.invoke('app:getDataDir'),
  openDataDir:  () => ipcRenderer.invoke('app:openDataDir'),
  isOnline:     () => ipcRenderer.invoke('app:isOnline'),

  // ── PostgreSQL setup ────────────────────────────────────────────────────────
  pgCheck:          ()       => ipcRenderer.invoke('pg:check'),
  pgCreate:         (pwd)    => ipcRenderer.invoke('pg:create', pwd),
  pgSetupComplete:  ()       => ipcRenderer.invoke('pg:setupComplete'),
  pgRetry:          ()       => ipcRenderer.invoke('pg:retry'),
  pgOpenDownload:   ()       => ipcRenderer.invoke('pg:openDownloadPage'),

  // Receive PG check result pushed from main process on window load
  onPgCheckResult: (cb) => {
    ipcRenderer.on('pg:checkResult', (_, data) => cb(data));
  },

  // ── Auto-updater ────────────────────────────────────────────────────────────
  updaterGetState: ()  => ipcRenderer.invoke('updater:getState'),
  updaterCheckNow: ()  => ipcRenderer.invoke('updater:checkNow'),
  updaterDownload: ()  => ipcRenderer.invoke('updater:download'),
  updaterInstall:  ()  => ipcRenderer.invoke('updater:install'),

  // Receive updater state change events pushed from main process
  onUpdaterState: (cb) => {
    ipcRenderer.on('updater:state', (_, data) => cb(data));
  },

  // ── Windows service ─────────────────────────────────────────────────────────
  serviceGetStatus:          ()  => ipcRenderer.invoke('service:getStatus'),
  serviceProbeHealth:        ()  => ipcRenderer.invoke('service:probeHealth'),
  serviceStart:              ()  => ipcRenderer.invoke('service:start'),
  serviceStop:               ()  => ipcRenderer.invoke('service:stop'),
  serviceIsWindowsService:   ()  => ipcRenderer.invoke('service:isUsingWindowsService'),
});
