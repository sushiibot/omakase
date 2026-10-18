package bot.sushii.omakase;

import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Own the foreground call session, including the gaps between spoken turns. */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {
    private AudioManager audio;
    private AudioFocusRequest focus;
    private AudioManager.OnModeChangedListener modeListener;
    private boolean active;
    private boolean keptScreenOn;
    private int previousVolumeStream;
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        if (change < 0) getActivity().runOnUiThread(() -> {
            if (!active) return;
            release();
            bridge.triggerWindowJSEvent("omakaseCallInterrupted");
        });
    };

    @PluginMethod public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (active) { call.resolve(); return; }
            if (!getActivity().getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) {
                call.reject("Open the app to start a call.");
                return;
            }
            audio = getContext().getSystemService(AudioManager.class);
            if (audio == null) { call.reject("Call audio is unavailable."); return; }
            try {
                int granted;
                if (Build.VERSION.SDK_INT >= 26) {
                    focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                        .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                        .setOnAudioFocusChangeListener(focusListener).build();
                    granted = audio.requestAudioFocus(focus);
                } else {
                    granted = audio.requestAudioFocus(focusListener, AudioManager.STREAM_VOICE_CALL,
                        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
                }
                if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                    abandonFocus();
                    call.reject("Another app is using call audio. End that call and try again.");
                    return;
                }
                previousVolumeStream = getActivity().getVolumeControlStream();
                keptScreenOn = (getActivity().getWindow().getAttributes().flags
                    & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0;
                active = true;
                audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
                // WebView releases its own recording mode between turns. Keep our call active.
                if (Build.VERSION.SDK_INT >= 31) {
                    modeListener = mode -> {
                        if (active && mode == AudioManager.MODE_NORMAL)
                            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    };
                    audio.addOnModeChangedListener(getContext().getMainExecutor(), modeListener);
                }
                getActivity().setVolumeControlStream(AudioManager.STREAM_VOICE_CALL);
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                call.resolve();
            } catch (RuntimeException error) {
                release();
                call.reject("Could not start Android call audio.", error);
            }
        });
    }

    @PluginMethod public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> { release(); call.resolve(); });
    }

    private void abandonFocus() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= 26 && focus != null) audio.abandonAudioFocusRequest(focus);
        else audio.abandonAudioFocus(focusListener);
        focus = null;
    }

    private void release() {
        if (active) {
            active = false;
            if (Build.VERSION.SDK_INT >= 31 && modeListener != null) {
                audio.removeOnModeChangedListener(modeListener);
                modeListener = null;
            }
            // MODE_NORMAL releases this process's request; Android restores other apps' requests.
            audio.setMode(AudioManager.MODE_NORMAL);
            getActivity().setVolumeControlStream(previousVolumeStream);
            if (!keptScreenOn) getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        abandonFocus();
    }

    @Override protected void handleOnStop() {
        if (active) {
            release();
            bridge.triggerWindowJSEvent("omakaseCallInterrupted");
        }
    }

    @Override protected void handleOnDestroy() { release(); }
}
