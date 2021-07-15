import {
  BrowserWindow,
  app,
  systemPreferences,
  ipcMain,
  globalShortcut,
  shell,
  Tray,
  Menu,
} from "electron";
import i18n from "i18next";
import Backend from "i18next-node-fs-backend";     
import { exitApp, RegisterKeybinds } from "./utils/keybinds";

import { HandleVoiceTray } from "./utils/tray";
import {
  ALLOWED_HOSTS,
  isLinux,
  isMac,
  isWin,  
  MENU_TEMPLATE,
} from "./constants";
import path from "path";
import { StartNotificationHandler } from "./utils/notifications";
import { bWindowsType } from "./types";
import electronLogger from "electron-log";
import { startRPC } from "./utils/rpc";

let mainUrlBase = "https://dogehouse.tv/" 
let localUrlBase = "http://localhost:3000"

let mainWindow: BrowserWindow;
let tray: Tray;
let menu: Menu;
let splash: BrowserWindow;

export let bWindows: bWindowsType;

export const __prod__ = app.isPackaged;
const instanceLock = app.requestSingleInstanceLock();
let shouldShowWindow = false;
let windowShowInterval: NodeJS.Timeout;
let skipUpdateTimeout: NodeJS.Timeout;

i18n.use(Backend);

electronLogger.transports.file.level = "debug"; 

if (isWin) app.setAppUserModelId("DogeHouse Reloaded");   

async function localize() {
  await i18n.init({
    lng: app.getLocale(),
    debug: false,
    backend: {
      // path where resources get loaded from
      loadPath: path.join(__dirname, "../locales/{{lng}}/translate.json"),
    },
    interpolation: {
      escapeValue: false,
    },
    saveMissing: true,
    fallbackLng: "en",
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    frame: isLinux,
    show: false,
  });

  // applying custom menu
  menu = Menu.buildFromTemplate(MENU_TEMPLATE);
  Menu.setApplicationMenu(menu);

  // applying custom tray
  tray = new Tray(path.join(__dirname, `../icons/tray.png`));

  if (!__prod__) {
    mainWindow.webContents.openDevTools();
  }
  mainWindow.loadURL(
    __prod__ ? mainUrlBase : localUrlBase    
  );

  bWindows = {
    main: mainWindow,
    overlay: undefined,
  };

  mainWindow.once("ready-to-show", () => {
    shouldShowWindow = true;
  });
  // crashes on mac only in dev
  // systemPreferences.askForMediaAccess("microphone");
  ipcMain.on("request-mic", async (event, _serviceName) => {
    const isAllowed: boolean = await systemPreferences.askForMediaAccess(
      "microphone"
    );
    event.returnValue = isAllowed;
  });
  if (isMac) {
    mainWindow.webContents.send("@alerts/permissions", true);
  }

  // start rpc
  startRPC();

  // registers global keybinds
  RegisterKeybinds(bWindows);

  // starting the custom voice menu handler
  HandleVoiceTray(mainWindow, tray);

  // starting the noti handler
  StartNotificationHandler();

  // graceful exiting
  mainWindow.on("closed", () => {
    globalShortcut.unregisterAll();
    if (bWindows.overlay) {
      bWindows.overlay.destroy();
    }
    mainWindow.destroy();
  });

  // handling external links
  const handleLinks = (event: any, url: string) => {
    let urlObj = new URL(url);
    let urlHost = urlObj.hostname;
    if (!ALLOWED_HOSTS.includes(urlHost)) {
      event.preventDefault();
      shell.openExternal(url);
    } else {
      if (
        (urlHost == ALLOWED_HOSTS[3] &&
          urlObj.pathname !== "/login" &&
          urlObj.pathname !== "/session" &&
          urlObj.pathname !== "/sessions/two-factor" &&
          urlObj.pathname !== "/sessions/two-factor/webauthn") ||
        (
          urlHost == ALLOWED_HOSTS[8] &&
          urlObj.pathname !== "/account/login_verification"
        )
      ) {
        event.preventDefault();
        shell.openExternal(url);
      }
    }
  };
  mainWindow.webContents.on("new-window", handleLinks);
  mainWindow.webContents.on("will-navigate", handleLinks);

  ipcMain.on("@dogehouse/loaded", (event, doge) => {
    if (isMac) mainWindow.maximize();
  });
  ipcMain.on("@app/quit", (event, args) => {
    mainWindow.close();
  });
  ipcMain.on("@app/maximize", (event, args) => {
    if (isMac) {
      if (mainWindow.isFullScreenable()) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
    } else {
      if (mainWindow.maximizable) {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize();
        } else {
          mainWindow.maximize();
        }
      }
    }
  });
  ipcMain.on("@app/minimize", (event, args) => {
    if (mainWindow.minimizable) {
      mainWindow.minimize();
    }
  });

  ipcMain.on("@app/hostPlatform", (event, args) => {
    event.sender.send("@app/hostPlatform", {
      isLinux,
      isMac,
      isWin,
    });
  });
}

function createSplashWindow() {
  splash = new BrowserWindow({
    width: 290,
    height: 400,
    transparent: true,
    frame: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  splash.loadFile(
    path.join(__dirname, "../resources/splash/splash-screen.html")
  );
  splash.webContents.on("did-finish-load", () => {
    splash.webContents.send("@locale/text", {
      title: i18n.t("common.title"),
      check: i18n.t("splash.check"),
      download: i18n.t("splash.download"),
      relaunch: i18n.t("splash.relaunch"),
      launch: i18n.t("splash.launch"),
      skipCheck: i18n.t("splash.skipCheck"),
      notfound: i18n.t("splash.notfound"),
    });
  });
}

if (!instanceLock) {
  if (process.env.hotReload) {
    app.relaunch();
  }
  exitApp();
} else {
  app.on("ready", () => {
    localize().then(async () => {
      createSplashWindow();
      skipUpdateCheck(splash);
    });
  });
  app.on("second-instance", (event, argv, workingDirectory) => {
    if (mainWindow) {
      if (process.env.hotReload) return mainWindow.close();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on("window-all-closed", async () => {
  exitApp();
});
app.on("activate", () => {
  if (mainWindow === null) {
    localize().then(() => {
      createMainWindow();
    });
  }
});

function skipUpdateCheck(splash: BrowserWindow) {
  createMainWindow();
  splash.webContents.send("notfound");
  if (isLinux || !__prod__) {
    splash.webContents.send("skipCheck");
  }
  // stop timeout that skips the update
  if (skipUpdateTimeout) {
    clearTimeout(skipUpdateTimeout);
  }
  windowShowInterval = setInterval(() => {
    if (shouldShowWindow) {
      splash.webContents.send("launch");
      clearInterval(windowShowInterval);
      setTimeout(() => {
        splash.destroy();
        mainWindow.show();
      }, 800);
    }
  }, 1000);
}
