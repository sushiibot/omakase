package app.omakase.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
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
    private DocumentFile root() throws IOException {
        String uri = prefs().getString("tree", null);
        if (uri == null) throw new IOException("Select your Obsidian vault in Settings.");
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), Uri.parse(uri));
        if (root == null || !root.isDirectory() || !root.canRead() || !root.canWrite())
            throw new IOException("Vault permission was lost. Select the folder again in Settings.");
        return root;
    }
    private JSObject statusValue() {
        JSObject result = new JSObject().put("version", 1).put("id", deviceId()).put("connected", false);
        try { DocumentFile root = root(); result.put("connected", true).put("name", root.getName()); }
        catch (Exception ignored) { }
        return result;
    }
    @PluginMethod public void status(PluginCall call) { io.execute(() -> call.resolve(statusValue())); }
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
            call.resolve(statusValue()); return;
        }
        Uri uri = data.getData();
        io.execute(() -> {
            try {
                int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                if (flags != (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)) throw new IOException("The vault needs read and write permission.");
                getContext().getContentResolver().takePersistableUriPermission(uri, flags);
                DocumentFile next = DocumentFile.fromTreeUri(getContext(), uri);
                if (next == null || !next.isDirectory() || !next.canWrite()) throw new IOException("Choose a writable notes folder.");
                String old = prefs().getString("tree", null);
                prefs().edit().putString("tree", uri.toString()).commit();
                if (old != null && !old.equals(uri.toString())) release(old);
                call.resolve(statusValue());
            } catch (Exception e) { call.reject(e.getMessage()); }
        });
    }
    private void release(String uri) {
        try { getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
        catch (SecurityException ignored) { }
    }
    @PluginMethod public void disconnect(PluginCall call) {
        io.execute(() -> {
            String uri = prefs().getString("tree", null);
            prefs().edit().remove("tree").commit();
            if (uri != null) release(uri);
            call.resolve();
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
            if (part.isEmpty() || part.startsWith(".") || java.util.regex.Pattern.compile("[\\\\:\\p{Cntrl}]").matcher(part).find())
                throw new IOException("Use a relative path without hidden folders or traversal.");
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
        if (!file.isFile()) throw new IOException("Not a regular note.");
        if (file.length() > LIMIT) throw new IOException("Note exceeds the 256 KiB limit.");
        try (InputStream in = getContext().getContentResolver().openInputStream(file.getUri()); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IOException("Could not open note.");
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) != -1) {
                if (out.size() + n > LIMIT) throw new IOException("Note exceeds the 256 KiB limit.");
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }
    static String hash(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return hex.toString();
    }
    private void write(DocumentFile file, byte[] bytes) throws IOException {
        try (OutputStream out = getContext().getContentResolver().openOutputStream(file.getUri(), "wt")) {
            if (out == null) throw new IOException("Could not open note for writing.");
            out.write(bytes);
            out.flush();
        }
    }
    private void backup(byte[] bytes, String path) throws Exception {
        File dir = new File(getContext().getFilesDir(), "vault-backups");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Could not create a recovery backup.");
        File file = new File(dir, System.currentTimeMillis() + "-" + UUID.randomUUID() + ".md");
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); out.getFD().sync(); }
        try (FileOutputStream out = new FileOutputStream(file + ".path")) { out.write(path.getBytes(StandardCharsets.UTF_8)); }
        File[] files = dir.listFiles((d, name) -> name.endsWith(".md"));
        if (files != null) {
            Arrays.sort(files, Comparator.comparing(File::getName));
            for (int i = 0; i < files.length - 50; i++) { files[i].delete(); new File(files[i] + ".path").delete(); }
        }
    }
    @PluginMethod public void execute(PluginCall call) {
        io.execute(() -> {
            try {
                if (!foreground) throw new IOException("Open omakase on your phone to access notes.");
                if (!"vault".equals(call.getString("rootId")) || !deviceId().equals(call.getString("machineId"))) throw new IOException("Wrong vault or device.");
                String path = call.getString("path", ".");
                String[] parts = parts(path);
                DocumentFile root = root();
                String action = call.getString("action", "");
                if (action.equals("list")) {
                    DocumentFile dir = find(root, parts, parts.length);
                    if (!dir.isDirectory()) throw new IOException("Not a folder.");
                    int offset = call.getInt("offset", 0);
                    if (offset < 0 || offset > 100000) throw new IOException("Invalid offset.");
                    DocumentFile[] children = dir.listFiles();
                    if (children.length > 10000) throw new IOException("Folder has too many entries. Choose a smaller vault.");
                    Arrays.sort(children, Comparator.comparing(f -> Objects.toString(f.getName(), "")));
                    JSArray entries = new JSArray(); int visible = 0;
                    for (DocumentFile child : children) {
                        String name = child.getName();
                        if (name == null || name.startsWith(".") || (!child.isDirectory() && !name.toLowerCase(Locale.ROOT).endsWith(".md"))) continue;
                        if (visible++ < offset || entries.length() >= 200) continue;
                        entries.put(new JSObject().put("name", name).put("type", child.isDirectory() ? "directory" : "file"));
                    }
                    JSObject response = new JSObject().put("entries", entries);
                    if (visible > offset + entries.length()) response.put("nextOffset", offset + entries.length());
                    call.resolve(response); return;
                }
                if (parts.length == 0 || !path.toLowerCase(Locale.ROOT).endsWith(".md")) throw new IOException("Only Markdown notes can be read or written.");
                if (action.equals("read")) {
                    byte[] bytes = read(find(root, parts, parts.length));
                    String content = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
                    if (content.indexOf('\0') >= 0) throw new IOException("Note contains binary data.");
                    call.resolve(new JSObject().put("content", content).put("hash", hash(bytes))); return;
                }
                if (!action.equals("write")) throw new IOException("Unsupported vault action.");
                String content = call.getString("content");
                if (content == null || content.indexOf('\0') >= 0) throw new IOException("Provide Markdown text.");
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > LIMIT) throw new IOException("Note exceeds the 256 KiB limit.");
                if (!call.getData().has("expectedHash")) throw new IOException("Read the note before writing; provide its hash or null to create.");
                String expected = call.getString("expectedHash");
                DocumentFile parent = find(root, parts, parts.length - 1);
                DocumentFile file = parent.findFile(parts[parts.length - 1]);
                byte[] previous = null;
                if (file != null) {
                    previous = read(file);
                    if (expected == null || !hash(previous).equals(expected)) throw new IOException("Note changed. Read it again before editing.");
                    backup(previous, path);
                    if (!hash(read(file)).equals(expected)) throw new IOException("Note changed during backup. Read it again.");
                } else {
                    if (expected != null) throw new IOException("Note no longer exists. Read the folder again.");
                    file = parent.createFile("text/markdown", parts[parts.length - 1]);
                    if (file == null) throw new IOException("Could not create note.");
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
                if (!hash(read(file)).equals(hash(bytes))) throw new IOException("Saved note changed. Read it before retrying; a recovery copy is available.");
                call.resolve(new JSObject().put("path", path).put("hash", hash(bytes)).put("saved", true));
            } catch (Exception e) { call.reject(e.getMessage() == null ? "Vault operation failed." : e.getMessage()); }
        });
    }
}
