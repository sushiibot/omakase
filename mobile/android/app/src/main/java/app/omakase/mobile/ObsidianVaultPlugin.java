package app.omakase.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import org.json.JSONObject;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// Keep the bridge name and persisted folder grant compatible with the first APK.
@CapacitorPlugin(name = "ObsidianVault")
public class ObsidianVaultPlugin extends Plugin {
    private static final int LIMIT = 262144;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile boolean foreground = true;
    private PluginCall picker;
    private SharedPreferences prefs() { return getContext().getSharedPreferences("vault", 0); }
    private String deviceId() {
        String id = prefs().getString("id", null);
        if (id == null) { id = "phone-" + UUID.randomUUID(); prefs().edit().putString("id", id).apply(); }
        return id;
    }
    private JSONObject folders() throws Exception {
        String saved = prefs().getString("folders", null);
        if (saved != null) return new JSONObject(saved);
        JSONObject folders = new JSONObject();
        String legacy = prefs().getString("tree", null);
        if (legacy != null) {
            String name = "Folder";
            try {
                DocumentFile file = DocumentFile.fromTreeUri(getContext(), Uri.parse(legacy));
                if (file != null) name = Objects.toString(file.getName(), name);
            } catch (SecurityException ignored) { }
            folders.put("vault", new JSONObject().put("uri", legacy).put("name", name));
        }
        saveFolders(folders);
        return folders;
    }
    private void saveFolders(JSONObject folders) throws IOException {
        if (!prefs().edit().putString("folders", folders.toString()).remove("tree").commit())
            throw new IOException("Could not save folder permissions. Try again.");
    }
    private DocumentFile root(String id) throws Exception {
        JSONObject folder = folders().optJSONObject(id);
        if (folder == null) throw new IOException("Folder is not connected. Select it in Settings.");
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), Uri.parse(folder.getString("uri")));
        if (root == null || !root.isDirectory() || !root.canRead() || !root.canWrite())
            throw new IOException("Folder permission was lost. Select the folder again in Settings.");
        return root;
    }
    private JSObject statusValue() throws Exception {
        JSArray entries = new JSArray();
        JSONObject folders = folders();
        boolean connected = false;
        Iterator<String> ids = folders.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            String name = folders.getJSONObject(id).optString("name", "Folder");
            boolean available = false;
            try { DocumentFile file = root(id); available = true; name = Objects.toString(file.getName(), name); }
            catch (Exception ignored) { }
            connected |= available;
            entries.put(new JSObject().put("id", id).put("name", name).put("available", available));
        }
        return new JSObject().put("version", 3).put("id", deviceId()).put("connected", connected).put("folders", entries);
    }
    @PluginMethod public void status(PluginCall call) { io.execute(() -> {
        try { call.resolve(statusValue()); } catch (Exception e) { call.reject(e.getMessage()); }
    }); }
    @PluginMethod public void choose(PluginCall call) {
        if (picker != null) { call.reject("The folder picker is already open."); return; }
        picker = call;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "folderChosen");
    }
    @ActivityCallback private void folderChosen(PluginCall call, ActivityResult result) {
        picker = null;
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            status(call); return;
        }
        Uri uri = data.getData();
        io.execute(() -> {
            boolean alreadyGranted = getContext().getContentResolver().getPersistedUriPermissions().stream().anyMatch(p -> p.getUri().equals(uri));
            boolean saved = false;
            try {
                int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                if (flags != (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)) throw new IOException("The folder needs read and write permission.");
                getContext().getContentResolver().takePersistableUriPermission(uri, flags);
                DocumentFile next = DocumentFile.fromTreeUri(getContext(), uri);
                if (next == null || !next.isDirectory() || !next.canRead() || !next.canWrite()) throw new IOException("Choose a writable folder.");
                JSONObject folders = folders();
                String id = null;
                Iterator<String> ids = folders.keys();
                while (ids.hasNext()) {
                    String candidate = ids.next();
                    if (uri.toString().equals(folders.getJSONObject(candidate).getString("uri"))) id = candidate;
                }
                if (id == null) {
                    if (folders.length() >= 16) { release(uri.toString()); throw new IOException("Disconnect a folder before adding another. The limit is 16."); }
                    id = "folder-" + UUID.randomUUID();
                }
                folders.put(id, new JSONObject().put("uri", uri.toString()).put("name", Objects.toString(next.getName(), "Folder")));
                saveFolders(folders);
                saved = true;
                call.resolve(statusValue());
            } catch (Exception e) {
                if (!alreadyGranted && !saved) release(uri.toString());
                call.reject(e.getMessage());
            }
        });
    }
    private void release(String uri) {
        try { getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
        catch (SecurityException ignored) { }
    }
    @PluginMethod public void disconnect(PluginCall call) {
        io.execute(() -> {
            try {
                String id = call.getString("rootId");
                JSONObject folders = folders();
                if (id == null || !folders.has(id)) throw new IOException("Choose a connected folder to disconnect.");
                String uri = folders.getJSONObject(id).getString("uri");
                folders.remove(id);
                saveFolders(folders);
                release(uri);
                call.resolve(statusValue());
            } catch (Exception e) { call.reject(e.getMessage()); }
        });
    }
    @Override protected void handleOnPause() { foreground = false; }
    @Override protected void handleOnResume() { foreground = true; }
    @Override protected void handleOnDestroy() { io.shutdown(); }

    static String[] parts(String path) throws IOException {
        if (path == null || path.length() > 2000) throw new IOException("Invalid relative path.");
        if (path.equals(".")) return new String[0];
        String[] parts = path.split("/", -1);
        for (String part : parts) {
            if (part.isEmpty() || (part.equals(".") || part.equals("..")) || java.util.regex.Pattern.compile("[\\\\:\\p{Cntrl}]").matcher(part).find())
                throw new IOException("Use a relative path without traversal.");
        }
        return parts;
    }
    private DocumentFile find(DocumentFile root, String[] parts, int count) throws IOException {
        DocumentFile file = root;
        for (int i = 0; i < count; i++) {
            if (!file.isDirectory()) throw new IOException("Parent is not a folder.");
            file = file.findFile(parts[i]);
            if (file == null) throw new IOException("File or parent folder does not exist.");
        }
        return file;
    }
    private byte[] read(DocumentFile file) throws IOException {
        if (!file.isFile()) throw new IOException("Not a regular file.");
        if (file.length() > LIMIT) throw new IOException("File exceeds the 256 KiB limit.");
        try (InputStream in = getContext().getContentResolver().openInputStream(file.getUri()); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IOException("Could not open file.");
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) != -1) {
                if (out.size() + n > LIMIT) throw new IOException("File exceeds the 256 KiB limit.");
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }
    static String text(byte[] bytes) throws IOException {
        try {
            String value = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
            if (value.indexOf('\0') >= 0) throw new IOException("Binary file: read with encoding=base64.");
            return value;
        } catch (java.nio.charset.CharacterCodingException e) {
            throw new IOException("File is not UTF-8 text: read with encoding=base64.");
        }
    }
    private String mimeType(String name) {
        int dot = name.lastIndexOf('.');
        String type = dot < 0 ? null : android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase(Locale.ROOT));
        return type == null ? "application/octet-stream" : type;
    }
    static String hash(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return hex.toString();
    }
    private void write(DocumentFile file, byte[] bytes) throws IOException {
        try (OutputStream out = getContext().getContentResolver().openOutputStream(file.getUri(), "wt")) {
            if (out == null) throw new IOException("Could not open file for writing.");
            out.write(bytes);
            out.flush();
        }
    }
    private void backup(byte[] bytes, String path) throws Exception {
        File dir = new File(getContext().getFilesDir(), "vault-backups");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Could not create a recovery backup.");
        File file = new File(dir, System.currentTimeMillis() + "-" + UUID.randomUUID() + ".bin");
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); out.getFD().sync(); }
        try (FileOutputStream out = new FileOutputStream(file + ".path")) { out.write(path.getBytes(StandardCharsets.UTF_8)); }
        File[] files = dir.listFiles((d, name) -> (name.endsWith(".md") || name.endsWith(".bin")));
        if (files != null) {
            Arrays.sort(files, Comparator.comparing(File::getName));
            for (int i = 0; i < files.length - 50; i++) { files[i].delete(); new File(files[i] + ".path").delete(); }
        }
    }
    @PluginMethod public void execute(PluginCall call) {
        io.execute(() -> {
            try {
                if (!foreground) throw new IOException("Open omakase on your phone to access files.");
                if (!deviceId().equals(call.getString("machineId"))) throw new IOException("Wrong folder or device.");
                String path = call.getString("path", ".");
                String[] parts = parts(path);
                DocumentFile root = root(call.getString("rootId", ""));
                String action = call.getString("action", "");
                if (action.equals("list")) {
                    DocumentFile dir = find(root, parts, parts.length);
                    if (!dir.isDirectory()) throw new IOException("Not a folder.");
                    int offset = call.getInt("offset", 0);
                    if (offset < 0 || offset > 100000) throw new IOException("Invalid offset.");
                    DocumentFile[] children = dir.listFiles();
                    if (children.length > 10000) throw new IOException("Folder has too many entries. Choose a smaller folder.");
                    Arrays.sort(children, Comparator.comparing(f -> Objects.toString(f.getName(), "")));
                    JSArray entries = new JSArray(); int visible = 0;
                    for (DocumentFile child : children) {
                        String name = child.getName();
                        if (name == null) continue;
                        try { parts(name); } catch (IOException invalid) { continue; }
                        if (visible++ < offset || entries.length() >= 200) continue;
                        entries.put(new JSObject().put("name", name).put("type", child.isDirectory() ? "directory" : "file"));
                    }
                    JSObject response = new JSObject().put("entries", entries);
                    if (visible > offset + entries.length()) response.put("nextOffset", offset + entries.length());
                    call.resolve(response); return;
                }
                if (parts.length == 0) throw new IOException("Choose a file inside the connected folder.");
                String encoding = call.getString("encoding", "utf8");
                if (!encoding.equals("utf8") && !encoding.equals("base64")) throw new IOException("Use utf8 or base64 encoding.");
                if (action.equals("read")) {
                    byte[] bytes = read(find(root, parts, parts.length));
                    String content;
                    if (encoding.equals("base64")) content = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
                    else content = text(bytes);
                    call.resolve(new JSObject().put("content", content).put("encoding", encoding).put("hash", hash(bytes))); return;
                }
                if (!action.equals("write")) throw new IOException("Unsupported file action.");
                String content = call.getString("content");
                if (content == null || content.length() > 349528) throw new IOException("Provide file content within the 256 KiB limit.");
                byte[] bytes;
                if (encoding.equals("base64")) {
                    if (content.length() % 4 != 0 || !content.matches("[A-Za-z0-9+/]*={0,2}")) throw new IOException("Provide valid base64 content.");
                    bytes = android.util.Base64.decode(content, android.util.Base64.NO_WRAP);
                    if (!android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP).equals(content)) throw new IOException("Provide canonical base64 content.");
                } else {
                    bytes = content.getBytes(StandardCharsets.UTF_8);
                    text(bytes);
                }
                if (bytes.length > LIMIT) throw new IOException("File exceeds the 256 KiB limit.");
                if (!call.getData().has("expectedHash")) throw new IOException("Read the file before writing; provide its hash or null to create.");
                String expected = call.getString("expectedHash");
                DocumentFile parent = find(root, parts, parts.length - 1);
                DocumentFile file = parent.findFile(parts[parts.length - 1]);
                byte[] previous = null;
                if (file != null) {
                    previous = read(file);
                    if (expected == null || !hash(previous).equals(expected)) throw new IOException("File changed. Read it again before editing.");
                    backup(previous, call.getString("rootId") + "/" + path);
                    if (!hash(read(file)).equals(expected)) throw new IOException("File changed during backup. Read it again.");
                } else {
                    if (expected != null) throw new IOException("File no longer exists. Read the folder again.");
                    file = parent.createFile(mimeType(parts[parts.length - 1]), parts[parts.length - 1]);
                    if (file == null) throw new IOException("Could not create file.");
                    if (!parts[parts.length - 1].equals(file.getName())) { file.delete(); throw new IOException("A file with this name appeared. Read the folder again."); }
                }
                try {
                    write(file, bytes);
                } catch (Exception failure) {
                    // Recover only a failed write; never automatically replay it through the transport.
                    if (previous != null) { try { write(file, previous); } catch (Exception ignored) { } }
                    else file.delete();
                    throw failure;
                }
                if (!hash(read(file)).equals(hash(bytes))) throw new IOException("Saved file changed. Read it before retrying; a recovery copy is available.");
                call.resolve(new JSObject().put("path", path).put("hash", hash(bytes)).put("saved", true));
            } catch (Exception e) { call.reject(e.getMessage() == null ? "File operation failed." : e.getMessage()); }
        });
    }
}
