package app.omakase.mobile;

import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private final BackNavigation backNavigation = new BackNavigation();
    private Toast exitToast;

    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeviceFsPlugin.class);
        registerPlugin(CallAudioPlugin.class);
        registerPlugin(AppUpdatesPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (bridge == null) {
                    finish();
                    return;
                }
                WebView webView = bridge.getWebView();
                String home = bridge.getConfig().getServerUrl() + "/assistant";
                // History includes SvelteKit's shallow entries for sheets and drawers.
                switch (backNavigation.press(webView.canGoBack(), home.equals(webView.getUrl()), SystemClock.elapsedRealtime())) {
                    case BACK -> webView.goBack();
                    // Replace the exhausted deep link so Back cannot loop between it and home.
                    case HOME -> webView.evaluateJavascript("location.replace(" + JSONObject.quote(home) + ")", null);
                    case CONFIRM -> {
                        if (exitToast != null) exitToast.cancel();
                        exitToast = Toast.makeText(MainActivity.this, R.string.press_back_to_exit, Toast.LENGTH_SHORT);
                        exitToast.show();
                    }
                    case EXIT -> {
                        if (exitToast != null) exitToast.cancel();
                        finish();
                    }
                }
            }
        });
    }

    @Override public void onPause() {
        backNavigation.reset();
        if (exitToast != null) exitToast.cancel();
        super.onPause();
    }
}
