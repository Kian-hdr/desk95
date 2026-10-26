# Desk95 for macOS

Desk95 1.1.0 is a native AppKit application hosting the same Windows 95 interface in WKWebView. The interface, W95FA font, scripts, styles, and icons are bundled in the app. It loads from local files and does not need Node, a browser, a local HTTP server, an account, or an internet connection.

## Installation and data

Open `/Applications/Desk95.app`. The Mac app uses its own persistent WebKit database, separate from browser profiles. Browser data is copied through a validated Desk95 ZIP backup. Import is repeat-safe for the same source file, and original browser data remains untouched. Changes made after migration are separate in the browser and Mac app; there is no automatic synchronization.

Use File → Import Backup to bring another browser workspace into the Mac app. Use File → Export Backup for a portable recovery copy. Attachments use native file pickers; exports use native save panels. Keep ZIP backups outside the application bundle. Replacing the app does not intentionally remove its database.

The native File menu exposes New Page, New Task, New Project, Save, Import, and Export. Command-K opens search; Command-comma opens appearance settings. The existing System/Light/Dark controls remain available. Closing or quitting first waits for pending document and property saves; failed saving offers Keep Open or an explicit Close Anyway.

## Build

```sh
./script/build_and_run.sh --verify
```

This builds and signs `output/macos/Desk95.app` and opens it as a Mac app. Close a running Desk95 normally first so pending changes are saved.

For a universal Release build:

```sh
DESK95_CONFIGURATION=release DESK95_UNIVERSAL=1 ./script/build_macos.sh
```

The universal executable contains arm64 and x86_64 slices. Minimum deployment target is macOS 14. Runtime verification in this task uses the current Apple Silicon Mac; Intel runtime has not been exercised.

Build-time requirements: Xcode/Swift and Node/npm for bundling. End users need only the app. The default build uses ad hoc signing for local development. For distribution, set `DESK95_SIGN_IDENTITY` to your Developer ID Application identity in Keychain; the build enables Hardened Runtime and a secure signing timestamp. No key material is included in source. `DESK95_BUILD_JOBS` defaults to 2 to bound build concurrency.

The native frontend uses a classic IIFE bundle because file-origin JavaScript modules do not load reliably in this WKWebView configuration. Its generated HTML restricts resource loading to bundled files and attachment blobs. No web security setting is disabled. Native bridge calls are accepted only from the app's local main frame. External http/https/mailto links open through the system and never replace the privileged interface.

## Verification and distribution

```sh
npm test
swift test --package-path native
npm run build
npm run test:browser
```

For isolated native testing, launch the generated app with `--test-store UUID`; this uses a separate persistent WKWebsiteDataStore and leaves the ordinary app workspace alone. Optional `--diagnostics PATH`, `--snapshot PATH`, `--import-backup PATH`, and `--export-backup PATH` support local verification. Migration copies and diagnostics belong in private Application Support, never in the app or repository. `script/verify_migration.mjs` compares backup contents after normalizing imported record identifiers and excluding navigation-only preferences.

Public builds are distributed through [GitHub Releases](https://github.com/Kian-hdr/desk95/releases). Each release records its signing/notarization status and SHA-256 checksum. A source build is not automatically notarized. Notarization requires Apple Developer Program credentials: submit the signed package with Apple's `notarytool`, wait for acceptance, staple the app, repackage, and verify Gatekeeper before distribution. Do not disable Gatekeeper to install a release.

Third-party notices accompany the app in Resources. W95FA's original font files and OFL license are bundled unchanged. Original Desk95 code is MIT licensed; bundled components retain their respective licenses.
