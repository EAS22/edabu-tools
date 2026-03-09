const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    initSession: () => ipcRenderer.invoke('init-session'),
    executeLogin: (data) => ipcRenderer.invoke('execute-login', data),
    searchNik: (data) => ipcRenderer.invoke('search-nik', data),
    refreshCaptcha: () => ipcRenderer.invoke('refresh-captcha'),
    reloadPage: () => ipcRenderer.invoke('reload-page'),
    solveCaptcha: () => ipcRenderer.invoke('solve-captcha'),
    onCaptchaSolverProgress: (callback) => ipcRenderer.on('captcha-solver-progress', callback),
    saveApiKeys: (data) => ipcRenderer.invoke('save-api-keys', data),
    getApiKeys: () => ipcRenderer.invoke('get-api-keys'),
    startupStatus: (payload) => ipcRenderer.send('startup-status', payload),
    startupReady: (payload) => ipcRenderer.send('startup-ready', payload),
    logout: () => ipcRenderer.invoke('logout'),
    quitApp: () => ipcRenderer.send('quit-app'),
    onForceLogoutPrompt: (callback) => ipcRenderer.on('force-logout-prompt', callback),
    onPuppeteerStatus: (callback) => ipcRenderer.on('puppeteer-status', callback),
    generateCardPDF: (data) => ipcRenderer.invoke('generate-card-pdf', data),
    previewCardPDF: (data) => ipcRenderer.invoke('preview-card-pdf', data)
});
