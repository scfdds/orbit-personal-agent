# Local macOS signing

`desktop-pack.mjs` builds and signs the finished app in an isolated `mkdtemp` directory under the system temporary directory. Packager's intermediate directory is also there. It signs native binaries first, nested frameworks and helper apps next, and `Orbit.app` last. Existing entitlements are preserved. The outer signing identifier is `app.orbit.workspace`, matching the app's Info.plist.

The build fails if `codesign --verify --deep --strict` fails. `--deep` is used only for verification, never for signing. After signing, do not modify files inside the app bundle.

The verified temporary bundle is archived first as `desktop-dist/Orbit-macOS-<arch>.zip`, with `Orbit.app` at the archive root. The existing ZIP is replaced only after archive creation succeeds. The app is then copied to `desktop-dist/Orbit-darwin-<arch>/Orbit.app` for convenience. Successful builds remove their temporary directory in `finally`; failed builds print and retain it for diagnosis, while removing an incomplete ZIP. `--stage-only` still stops after preparing production dependencies, without packaging or signing.

Documents and other File Provider-managed folders can acquire `com.apple.FinderInfo` again after it is removed. If the workspace convenience copy fails strict verification, the script warns without re-signing it or invalidating the earlier ZIP. Even a convenience copy that verifies immediately may acquire metadata later. Install from the ZIP into the fixed path `~/Applications/Orbit.app` and launch that copy. Do not re-sign a workspace copy to work around FinderInfo: that changes its ad hoc identity and can invalidate an existing permission grant. The pack script never changes an installed app or its permissions.

This uses local ad hoc signing (`--sign -`). It fixes the invalid resource seal left after renaming/repacking Electron, without a certificate or keychain changes. It is **not** Developer ID signing or notarization, and does not guarantee that macOS will retain Full Disk Access or Accessibility permission across rebuilt versions. No identifier-only designated requirement is added to pretend that ad hoc builds have a stable trusted identity.

Use one stable installation path and launch that app normally. After replacing an app, permission must be checked by the newly running process; a visually enabled switch for an older copy is not sufficient evidence. Request permission only in response to the user's explicit action. A helper may be represented by the parent app's name in System Settings.

Validation: `node --test desktop/signing.test.cjs` signs and verifies an isolated temporary fixture, checks nested code and native resources, then verifies that changing a resource invalidates the seal. It never launches the app/helper or requests system permissions.

References:

- [Apple TN2206: macOS Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/_index.html), nested code and `--deep`.
- [Apple QA1940: Resource fork, Finder information, or similar detritus not allowed](https://developer.apple.com/library/archive/qa/qa1940/_index.html), FinderInfo and resource-fork metadata on signed bundles.
- [Apple DTS: On File System Permissions](https://developer.apple.com/forums/thread/678819), responsible code and ad hoc identity limitations. This describes general TCC behavior, not a guarantee about every Accessibility attribution path.
