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

## Device permissions and call audio

Android requests permissions when you use the related feature. The app does not request them at startup.

| Feature | Permission or configuration |
| --- | --- |
| Voice calls and dictation | `RECORD_AUDIO` shows the microphone permission prompt. `MODIFY_AUDIO_SETTINGS` allows communication audio mode. |
| Share location | `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` allow the location prompt. Approximate location also works. |
| Attach photos | The system file picker grants read access to selected photos. No photo-library or storage permission is needed. |
| Take photo | A manifest query makes the system camera visible to Capacitor. The camera receives temporary access to an app-owned image file. |
| Local folders | The system folder picker grants persistent access to the selected folders. No broad storage permission is needed. |
| Clipboard | The existing foreground copy buttons need no manifest permission. |
| Network | `INTERNET` is declared. The configured server must use HTTPS. Cleartext and mixed content remain disabled. |

Live and turn-based calls request audio focus and use `MODE_IN_COMMUNICATION` through the `CallAudio` plugin.
The volume buttons control call volume while the call is active.
Android chooses the audio route. The app does not scan for Bluetooth devices or request nearby-device access.
On Android 12 and later, the plugin maintains communication mode when WebView releases the microphone between turns.
The screen stays awake during a call without a wake-lock permission.
Ending a call releases audio focus, communication mode, the volume override, and the screen flag.
Audio-focus loss ends the call. Returning from another app does not restart it automatically.
Older APKs without this plugin retain the existing WebView audio behavior.

These assistant calls do not dial telephone numbers. They need no `CALL_PHONE`, phone-state, or call-log permissions.
The composer's **Take photo** action uses the system camera through an image-capture intent.
This action needs no direct `CAMERA` permission. Direct WebView camera capture would need a separate permission and implementation.
The file provider exposes the app's camera image directory and cache, rather than the whole external storage tree.

Background calls and native notifications need additional implementation before their permissions can help.
Background calls need a foreground microphone service, a persistent notification, and call lifecycle handling.
Native push needs notification delivery and registration, plus `POST_NOTIFICATIONS` on Android 13 and later.
The current app stops voice calls when hidden and has no foreground service or native push registration.
Do not add these permissions without implementing their features.

Each folder grant already persists across app restarts. It also permits access from a background component.
The current device connection runs in the WebView and stops when the app is hidden.
Background file access needs native request handling, authentication, and a foreground service or scheduled jobs.
A foreground service needs an ongoing notification and a disconnect action.
Android 15 and later limit `dataSync` foreground services to six background hours per 24 hours.
This limit prevents a simple promise of unlimited background access through that service type.
See [Android's background service limits](https://developer.android.com/about/versions/15/behavior-changes-15).

After installing an updated APK, test microphone denial and retry, photo selection and cancellation, and approximate location sharing.
Test both voice modes with the phone speaker, wired audio, and a Bluetooth headset.
Check volume buttons, incoming phone calls, headset disconnection, backgrounding, and audio restoration after hangup.
No connected-device test is implied by a successful APK build.

Android references: [audio routing](https://developer.android.com/develop/connectivity/bluetooth/ble-audio/audio-manager),
[permission alternatives](https://developer.android.com/privacy-and-security/minimize-permission-requests),
and [location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions/runtime).

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
The phone has an ID beginning with `phone-` and one root ID per selected folder.
PC shares remain read-only. The Android folder exposes these actions:

| Action | Parameters and behavior |
| --- | --- |
| `list` | `path`, optional entry `offset`; returns up to 200 entries and `nextOffset`. |
| `read` | `path`; returns UTF-8 content and its SHA-256 `hash`. |
| `write` | `path`, `content`, `expectedHash`; creates missing parent folders. Use null to create a new file. |
| `edit` | `path`, `oldText`, `newText`, `expectedHash`; replaces exactly one matching text span. |
| `mkdir` | `path`; creates the directory and missing parent directories. |
| `find` | `path`, `query`; recursively matches literal text in relative paths. |
| `grep` / `search` | `path`, `query`; recursively matches literal text in files and returns line numbers. |
| `rename` | `path`, `name`; renames an entry in its current directory without replacing an existing entry. |
| `delete` | `path`, optional `recursive`; nonempty directories require `recursive: true`. |

Every action requires `machineId` and `rootId`. Paths are relative to the selected folder.
Hidden files and all file extensions are accessible. Reading and writing support files up to 256 KiB. Use `encoding: "base64"` for binary contents.
Shell execution is not supported.
Search stops at 2,000 entries, 32 directory levels, or 100 results.
Search reports `truncated: true` when limits or unreadable files prevent a complete result.

Writes and edits require the hash from the latest read. A stale hash rejects the change.
Android document providers cannot compare and save atomically. Concurrent edits during the final write can still conflict.
The transport never retries a mutation. After a timeout, inspect the affected paths before retrying.
Deletion is permanent. Recovery copies cover overwritten files only.

Install the updated APK to use device filesystem operations. Older APKs retain their existing operations and advertise only supported actions.
Existing folder grants and recovery copies remain available. Folder IDs remain unchanged.

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
