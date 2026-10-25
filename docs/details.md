# Details

## What it changes

Spotify's own desktop code reads a JSON preference named `remote-config-overrides` in its Chromium local-storage database. This app sets exactly one property:

```json
{ "enableLyricsVariationsInNPV": "CONTROL" }
```

It preserves other feature overrides, saves the previous value of this flag for **Undo**, and updates Chromium's storage-size metadata in the same atomic LevelDB batch. Undo restores this flag while preserving changes made to other preferences since the repair. It also turns off automatic repair.

It does **not** modify Spotify's executable, application bundle, JavaScript, CSS, account subscription, ads, updates, or audio. No developer mode, Spicetify, or injected extension is required. Inspection opens a temporary copy; writing requires the real database's exclusive lock. The lock is never bypassed.

New stock profiles without an override record are supported: the app reads the canonical username from Spotify's local `prefs` file and requires another existing storage key in that same namespace before creating the preference. Existing account namespaces with override records are also supported.

## If it doesn't work

Click **Report a problem** after a fix attempt. It also appears if settings cannot be found or read. The tool runs checks locally and explains common causes, such as a reset preference, locked database, unfamiliar settings format, or Spotify already being open during an automatic startup check. It can verify the saved setting; it cannot prove what Spotify displays on your screen.

Choose what went wrong and review **View report details**. To share it, check **I agree to send this report** and click **Send report**. Reports go privately to the developer. **No GitHub account, Spotify account connection, email address, or login is needed to report a problem.** You can also save a report locally instead.

Reports contain a fixed set of fields: helper version, operating-system version and architecture, Spotify's last-launched version, installation type, running/settings state, recognized lyrics-flag values, error categories, last fix result, automatic-repair state, and a selected issue category. Unknown flag strings are replaced with `OTHER`. No arbitrary text, file paths, Spotify usernames, credentials, songs, screenshots, or full logs are accepted. See the [shared report schema](../src/report-schema.mjs).

The receiver uses Supabase in the US West region. Only the developer's backend role can read reports. Each report gets a random receipt ID, which is not a persistent device identifier. Supabase processes the network address needed to deliver a request and may keep infrastructure logs. For spam control, the function uses a secret-keyed, daily-changing hash of the network address; limit buckets expire after two days. Intake is capped at five reports per network address per hour and 200 reports total per day. Reports older than 90 days are removed when new reports arrive; the developer can also delete reports manually by receipt ID.

The automatic checks use local rules. Reports give the maintainer information to investigate and update the fix; submitting one does not grant remote access to your computer.

## Privacy and backups

Fixing and startup checks work offline. There is no background analytics. The app sends diagnostic data only when you review a report, give permission, and click Send. Failed sends are not queued or retried automatically. It never asks for a Spotify password or token. It uses the canonical username only to locate the correct local preference. Backups contain the previous lyrics value, local storage-key identifier, and database path; they do not contain a whole Spotify profile or login credentials.

Its settings and undo backup stay in the current user's application data directory (`Classic Lyrics`). Temporary inspection copies are deleted after each check. Uninstalling the helper leaves the chosen Spotify preference in place; use **Undo** first if you want the earlier behavior back.

## Compatibility and limits

- Windows 10/11 x64, including discovery of common Microsoft Store profile paths.
- macOS 13 (Ventura) or newer, with a universal app for Intel and Apple silicon.
- The native flag repair was verified against **Spotify for Windows 1.3.6.1921**. macOS builds run the same repair/undo tests and packaged-native-module smoke test in CI; the layout has not been visually verified against a live Mac Spotify installation.
- Windows and Mac profile discovery is deliberately restricted to Spotify's standard directories. If a profile cannot be recognized, the app does not guess a database or reset other settings.
- This depends on Spotify continuing to honor this native flag. If Spotify removes the old layout or changes its storage format, a new helper release may be needed. Saving a preference cannot bring back code Spotify has removed.

## Development

Node.js 24 and npm:

```sh
npm ci
node node_modules/electron/install.js
npm test
npm start
```

Package on the corresponding operating system:

```sh
npm run dist:win
npm run dist:mac
```

`node build/make-icons.cjs` regenerates the original project icons. The packaged app supports `--self-test --report=/path/to/report.json`; this uses a synthetic temporary database and never touches Spotify. GitHub Actions tests on Windows and macOS, builds the direct-download installers, smoke-tests packaged native modules, and publishes releases for `v*` tags. See [the release workflow](../.github/workflows/release.yml).

The report receiver source and setup notes are in [server/](../server/README.md). The public-client key in `reporting-config.json` grants no read or direct write access to the private tables. Never replace it with a service-role key.

## Research and related projects

The [Spotify Community reports](https://community.spotify.com/forum/en/discussion/comment/7559137) describe the full-window lyrics behavior. [Spicetify's experimental-feature helper](https://github.com/spicetify/cli/blob/main/jsHelper/expFeatures.js) exposes Spotify's native override APIs, and [SpotX's flag catalog](https://github.com/SpotX-Official/SpotX/blob/main/patches/patches.json) identifies the lyrics flag. Those are broader customization tools. Searches of GitHub repositories and this flag did not reveal a dedicated, packaged cross-platform helper that only persists this setting and monitors resets as of October 21, 2026.

Storage handling follows Chromium's [local-storage schema](https://chromium.googlesource.com/chromium/src/+/main/components/services/storage/dom_storage/) and uses [classic-level](https://github.com/Level/classic-level). This implementation is original; it does not vendor code from Spotify, Spicetify, or SpotX.

MIT licensed. Independent project, not affiliated with or endorsed by Spotify.
