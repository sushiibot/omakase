package bot.sushii.omakase;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdates")
public class AppUpdatesPlugin extends Plugin {
    private final AtomicBoolean busy = new AtomicBoolean();

    @PluginMethod public void status(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionCode", version(info));
            result.put("versionName", info.versionName);
            call.resolve(result);
        } catch (Exception e) { call.reject("Could not read the installed Android version.", e); }
    }

    @PluginMethod public void install(PluginCall call) {
        Integer code = call.getInt("versionCode");
        String url = call.getString("url", "");
        String hash = call.getString("sha256", "");
        if (code == null || code < 1 || !url.equals("https://github.com/sushiibot/omakase/releases/download/android-" + code + "/omakase.apk") || !hash.matches("[a-f0-9]{64}")) {
            call.reject("Invalid Android release."); return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
                    JSObject result = new JSObject(); result.put("permissionRequired", true); call.resolve(result);
                } catch (Exception e) { call.reject("Open Android settings to allow installs from omakase.", e); }
            });
            return;
        }
        if (!busy.compareAndSet(false, true)) { call.reject("An Android update is already downloading."); return; }
        new Thread(() -> {
            File file = new File(getContext().getCacheDir(), "omakase-update.apk");
            try {
                download(url, file, hash);
                PackageManager pm = getContext().getPackageManager();
                // The existing debug key is stable; require the exact installed signer, package and newer version.
                @SuppressWarnings("deprecation")
                PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
                @SuppressWarnings("deprecation")
                PackageInfo next = pm.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNATURES);
                if (next == null || !installed.packageName.equals(next.packageName) || version(next) != code || version(next) <= version(installed) ||
                    next.signatures == null || installed.signatures == null || !Arrays.equals(installed.signatures, next.signatures)) {
                    throw new IllegalArgumentException("The APK does not match this app's signing key or version.");
                }
                getActivity().runOnUiThread(() -> {
                    try {
                        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive");
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getActivity().startActivity(intent);
                        call.resolve();
                    } catch (Exception e) { call.reject("Could not open Android's installer. Try again.", e); }
                    finally { busy.set(false); }
                });
            } catch (Exception e) {
                file.delete();
                busy.set(false);
                call.reject(e instanceof IllegalArgumentException ? e.getMessage() : "Could not download the Android update. Check your connection and try again.", e);
            }
        }, "omakase-update").start();
    }

    @SuppressWarnings("deprecation") private static long version(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private static void download(String source, File file, String expectedHash) throws Exception {
        URI uri = URI.create(source);
        long deadline = System.currentTimeMillis() + 180_000;
        for (int redirects = 0; redirects < 5; redirects++) {
            String host = uri.getHost();
            if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null ||
                !("github.com".equals(host) || "release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host))) {
                throw new IllegalArgumentException("Untrusted Android download URL.");
            }
            HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) { uri = uri.resolve(connection.getHeaderField("Location")); continue; }
                if (status != 200) throw new java.io.IOException("Download failed: " + status);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (var input = connection.getInputStream(); var output = new FileOutputStream(file)) {
                    byte[] bytes = new byte[65536];
                    long total = 0;
                    int count;
                    while ((count = input.read(bytes)) != -1) {
                        total += count;
                        if (total > 100 * 1024 * 1024 || System.currentTimeMillis() > deadline) throw new java.io.IOException("Download limit exceeded");
                        digest.update(bytes, 0, count);
                        output.write(bytes, 0, count);
                    }
                }
                StringBuilder hash = new StringBuilder();
                for (byte b : digest.digest()) hash.append(String.format("%02x", b & 255));
                if (!expectedHash.equals(hash.toString())) throw new IllegalArgumentException("Android download checksum failed. Try again.");
                return;
            } finally { connection.disconnect(); }
        }
        throw new java.io.IOException("Too many redirects");
    }
}
