# Android app

The Capacitor app loads `https://agent.sushii.bot` and uses the existing owner authentication.
The gateway and agent stay on the server. The phone exposes one selected Obsidian vault while the app is open.
There is no background service, vault scanner, or periodic file synchronization.

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

## Connect a vault

1. Open the Android app.
2. Open Settings.
3. Select **Connect vault**.
4. Select the existing Obsidian vault in the Android folder picker.
5. Grant access to the folder.
6. Keep omakase open while the agent works on notes.

The folder permission persists across app restarts. **Disconnect vault** releases it.
Changing folders replaces the previous permission. A canceled picker keeps the previous folder.

## File operations

The agent uses `machine_files` with `action: "list_machines"` to discover the phone.
The phone has an ID beginning with `phone-` and one root named `vault`.
It advertises `list`, `read`, and `write`. PC shares remain read-only.

```json
{ "action": "list", "machineId": "phone-<uuid>", "rootId": "vault", "path": "." }
{ "action": "read", "machineId": "phone-<uuid>", "rootId": "vault", "path": "Notes.md" }
{ "action": "write", "machineId": "phone-<uuid>", "rootId": "vault", "path": "Notes.md", "content": "Updated note", "expectedHash": "<hash-from-read>" }
```

Use `expectedHash: null` to create a new note. Parent folders must already exist.
Reads return the full UTF-8 note and its SHA-256 hash. Notes have a 256 KiB limit.
Listings return 200 entries per page. Use `nextOffset` as the next request's `offset`.
Hidden paths, including `.obsidian`, are excluded. Attachments, deletion, renaming, and search are not supported.

The native plugin checks the current hash before overwriting a note.
Android document providers do not support an atomic compare-and-save operation.
An edit from Obsidian during the final write can still conflict. Avoid simultaneous edits to the same note.

The transport never retries native writes automatically. A timeout or disconnect can leave the outcome unknown.
After an uncertain write, read the note before deciding whether to retry.

## Recovery copies

Before overwriting a note, the app saves its old contents in private storage.
It keeps the latest 50 copies in `files/vault-backups`. Each `.path` file identifies the corresponding note.
To extract backups from a debug installation, run:

```sh
adb exec-out run-as app.omakase.mobile tar -cf - files/vault-backups > vault-backups.tar
```

Backups are local to the app. They do not replace your normal vault backup.

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

Before using important notes, test the installed APK with a disposable vault:

1. Select a folder containing a Markdown note.
2. Ask the agent to list and read that note.
3. Ask the agent to create a new note.
4. Ask the agent to update the original note.
5. Check both notes in Obsidian.
6. Change the note after a read, then check that a write with the old hash fails.
7. Background the app and check that new operations fail or time out.
8. Reopen the app and check that the vault reconnects.
9. Disconnect the vault and check that access stops.
