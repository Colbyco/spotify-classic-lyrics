# Windows installed update smoke test

Run `node scripts/updater-smoke.cjs` on a disposable Windows CI runner after
`npm ci` and Electron's install step. It refuses execution unless Windows and
`CI=true`. Allow roughly 10 extra minutes for two NSIS builds and an installation.
Do not set `CI=true` to run it on a personal computer.

The script builds a uniquely named fixture from the real `src/updates.cjs` adapter,
installs 0.0.1 into its own temporary directory, and serves builder-generated 0.0.2
update metadata and installer over a loopback HTTP feed. It checks that:

- background eligibility creates no updater and makes zero feed requests;
- an incorrect SHA-512 rejects a real installer download;
- the correct download reaches ready without installing or quitting;
- an unfinished fix blocks installation;
- explicit permission calls `quitAndInstall(false, true)`;
- the installed executable relaunches as 0.0.2 and retains fixture settings.

The fixture uses its own app ID, executable, registry installation, updater cache,
and user-data directory. It never launches or replaces Classic Lyrics or Spotify.
No production feed or GitHub release is used. The successful run uninstalls its
fixture; diagnostics remain under the printed temporary directory. Failed runs
may leave only that fixture installed on the disposable runner.

Suggested workflow step (after dependencies, before release publication):

```yaml
- name: Test installed Windows updater
  if: runner.os == 'Windows'
  timeout-minutes: 12
  run: node scripts/updater-smoke.cjs
```

This tests the adapter and real NSIS/electron-updater download/install/restart flow.
It does not test production UI wiring, GitHub's provider, differential download,
publisher signatures, Mac signing, or Spotify repair. Existing unit and packaged
application smoke tests should remain. The local feed is deliberately test-only;
production must retain the configured GitHub HTTPS provider.
