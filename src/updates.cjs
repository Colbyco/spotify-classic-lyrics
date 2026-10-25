'use strict';

// Only the installed Windows app can update itself. Sign-in repair stays a
// bounded, offline task; portable and Mac downloads keep their manual workflow.
function supportsUpdates({ packaged, platform, portable, background, selfTest }) {
  return !!packaged && platform === 'win32' && !portable && !background && !selfTest;
}

function createUpdates({ updater, onChange, canInstall = () => true }) {
  let state = { kind: 'idle', message: '' }, active = false;
  const publish = patch => { state = { ...patch }; onChange(state); return state; };
  const fail = () => { active = false; publish({ kind: 'error', message: 'Update unavailable. Try again later.' }); };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  updater.logger = null;
  updater.on('checking-for-update', () => publish({ kind: 'checking', message: 'Checking for updates…' }));
  updater.on('update-available', info => publish({ kind: 'downloading', message: 'Downloading update…', version: info.version }));
  updater.on('download-progress', progress => {
    const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, Math.floor(progress.percent))) : 0;
    publish({ kind: 'downloading', message: `Downloading update… ${percent}%`, version: state.version });
  });
  updater.on('update-not-available', () => { active = false; publish({ kind: 'current', message: 'Up to date' }); });
  updater.on('update-downloaded', info => { active = false; publish({ kind: 'ready', message: `Version ${info.version} is ready`, version: info.version }); });
  updater.on('error', fail);
  updater.on('update-cancelled', fail);
  return {
    get state() { return state; },
    async check() {
      if (active || state.kind === 'ready') return state;
      active = true;
      publish({ kind: 'checking', message: 'Checking for updates…' });
      try {
        const result = await updater.checkForUpdates();
        // checkForUpdates resolves before the automatic download finishes.
        if (result?.downloadPromise) void result.downloadPromise.catch(fail);
        else if (state.kind === 'checking') { active = false; publish({ kind: 'current', message: 'Up to date' }); }
      } catch { fail(); }
      return state;
    },
    install() {
      if (state.kind !== 'ready') throw new Error('The update has not finished downloading.');
      if (!canInstall()) throw new Error('Wait for the Spotify check or fix to finish.');
      // Closing the helper normally never installs an update or stops Spotify.
      publish({ kind: 'installing', message: 'Restarting to update…' });
      try { updater.quitAndInstall(false, true); }
      catch { fail(); }
      return state;
    }
  };
}
module.exports = { supportsUpdates, createUpdates };
