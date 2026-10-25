Automatic checks now run once at helper startup, instead of polling Spotify's settings every 15 seconds.

- Compact window with **Fix lyrics layout**, Undo, and optional automatic repair.
- **Report a problem** runs local checks, lets you review the report, and sends it privately only with your permission. No account needed.
- **Check and fix at startup** checks once at sign-in, applies the setting if Spotify is closed, then exits.
- If Spotify is already open, use **Fix lyrics layout**, or quit Spotify and reopen the helper. No repair is queued in the background.

Downloads:

- **Classic-Lyrics-Setup-1.0.2.exe** — Windows 10/11 x64. Install this for automatic startup.
- **Classic-Lyrics-Portable-1.0.2.exe** — Windows x64, one-time use without installation.
- **Classic-Lyrics-1.0.2-macOS-Universal.dmg** — macOS 13+, Intel and Apple silicon. Open it and drag the app to Applications.

Windows builds are unsigned. The Mac app is ad-hoc signed and is not Apple-notarized, so the operating system may show a publisher/security warning. SHA-256 checksums are included.

Windows and macOS builds run repair/undo, one-time startup repair, report-privacy, consent, packaged-native-module, and renderer-flow tests. The setting's visible effect was verified on Spotify for Windows 1.3.6.1921; it has not been visually verified on a live Mac Spotify installation. Spotify must continue to support the underlying layout flag.
