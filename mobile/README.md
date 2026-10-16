# Android app

The Capacitor app loads `https://agent.sushii.bot` and uses the existing owner authentication.
The gateway and agent stay on the server. The phone exposes the local folders you select while the app is open.
There is no background service, file scanner, or periodic file synchronization.

## Download from GitHub Actions

Open [Android APK](https://github.com/sushiibot/omakase/actions/workflows/android.yml) and select a successful run on `main`.
Download its `omakase-android-<run number>` artifact, extract the ZIP, and install `omakase.apk` on your phone.
The artifact also contains a SHA-256 checksum. Downloads require a GitHub login and expire after 7 days.

The workflow runs when Android files change on `main`. Use **Run workflow** on `main` to request another build.
Web changes reach the app through its live server URL and do not require a new APK.
Pull requests run Android tests and build checks, without the persistent signing key or a downloadable artifact.
No GitHub release is created.

CI uses the `ANDROID_DEBUG_KEYSTORE_BASE64` repository secret to preserve the signing identity across builds.
It contains the base64-encoded `mobile/.local/debug.keystore` from the initial local build.
Keep that file private and retain a backup. CI fails when the secret is missing.
Each CI run increases the Android version code so later APKs can update the installed app.
The APK remains a debug build for personal use.

## Build and install

Install Bun, a Java 21 JDK, and the Android SDK with platform 36 and build tools 35 and 36.
Set `ANDROID_HOME` to the SDK directory.

From `mobile/`, run:

```sh
bun install --frozen-lockfile
bun run build
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is suitable for personal sideloading. Keep the same signing key for later updates.
Local builds reuse `mobile/.local/debug.keystore` when that file exists. Otherwise, Gradle uses the standard Android debug key.
Uninstalling the app removes its folder permission and private recovery backups.

To use another server, supply an HTTPS origin:

```sh
OMAKASE_URL=https://your-private-host.example bun run build
```

Only the configured origin loads inside the native bridge. External links use the system browser.
The app requires a current Android System WebView. Capacitor injects its bridge before document scripts on current WebView versions.
The app does not register the PWA service worker. The browser PWA remains available separately.
The wrapper requires network access at startup. Connect the phone to the private network before opening it.
Browser push notifications are not supported inside this WebView. Native push is outside this feature.

## Connect folders

1. Open the Android app.
2. Open Settings.
3. Select **Add folder**.
4. Select the folder to share in the Android folder picker.
5. Grant access to the folder.
6. Keep omakase open while the agent works on files.

Folder permissions persist across app restarts. Add up to 16 folders.
Each folder has its own **Disconnect** button. Disconnecting one folder keeps the others available.
Selecting the same folder again refreshes its permission without adding a duplicate. Canceling the picker changes nothing.

## File operations

The agent uses `machine_files` with `action: "list_machines"` to discover the phone.
The phone has an ID beginning with `phone-`. Each folder has a stable root ID from `list_machines`.
Existing installations keep their original `vault` root and folder permission. New folders use IDs beginning with `folder-`.
It advertises `list`, `read`, and `write`. PC shares remain read-only.

```json
{ "action": "list", "machineId": "phone-<uuid>", "rootId": "<root-id-from-list_machines>", "path": "." }
{ "action": "read", "machineId": "phone-<uuid>", "rootId": "<root-id-from-list_machines>", "path": "example.txt" }
{ "action": "write", "machineId": "phone-<uuid>", "rootId": "<root-id-from-list_machines>", "path": "example.txt", "content": "Updated file", "expectedHash": "<hash-from-read>" }
```

Use `expectedHash: null` to create a new file. Parent folders must already exist.
Reads return the full file and its SHA-256 hash. Files have a 256 KiB limit.
Use `encoding: "utf8"` for text (the default), or `encoding: "base64"` for binary reads and writes.
Listings return 200 entries per page. Use `nextOffset` as the next request's `offset`.
All file types and hidden paths inside the selected folder are available. Deletion, renaming, creating folders, and search are not supported.
The bridge name remains unchanged so existing folder permissions survive the update.
Older APKs still support Markdown only; the agent sees their advertised file types.

The native plugin checks the current hash before overwriting a file.
Android document providers do not support an atomic compare-and-save operation.
An edit from another app during the final write can still conflict. Avoid simultaneous edits to the same file.

The transport never retries native writes automatically. A timeout or disconnect can leave the outcome unknown.
After an uncertain write, read the file before deciding whether to retry.

## Recovery copies

Before overwriting a file, the app saves its old contents in private storage.
It keeps the latest 50 copies in `files/vault-backups`. Each `.path` file records the folder ID and relative file path. Older backups contain only the relative path from the original folder.
To extract backups from a debug installation, run:

```sh
adb exec-out run-as app.omakase.mobile tar -cf - files/vault-backups > vault-backups.tar
```

Backups are local to the app. They do not replace your normal file backup.

## Validation

From `mobile/`, run:

```sh
bun run sync
cd android
./gradlew testDebugUnitTest assembleDebug
```

Gateway tests cover request correlation, reconnects, timeouts, and path validation.
Browser tests simulate the native bridge to check connection controls and operation delivery.
Java tests cover relative paths and content hashes.

Before using important files, test the installed APK with a disposable folder:

1. Select a folder containing a text file.
2. Ask the agent to list and read that file.
3. Ask the agent to create a new file.
4. Ask the agent to update the original file.
5. Check both files with another app.
6. Change the file after a read, then check that a write with the old hash fails.
7. Background the app and check that new operations fail or time out.
8. Reopen the app and check that the folder reconnects.
9. Add a second folder and check that both appear to the agent.
10. Disconnect one folder and check that only its access stops.
