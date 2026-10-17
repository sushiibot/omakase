package app.omakase.mobile;

/** Back must exhaust history, reach home, then receive a second press to exit. */
final class BackNavigation {
    enum Action { BACK, HOME, CONFIRM, EXIT }
    private long confirmedAt = -1;

    Action press(boolean canGoBack, boolean atHome, long now) {
        if (canGoBack || !atHome) {
            reset();
            return canGoBack ? Action.BACK : Action.HOME;
        }
        if (confirmedAt >= 0 && now - confirmedAt < 2000) {
            reset();
            return Action.EXIT;
        }
        confirmedAt = now;
        return Action.CONFIRM;
    }

    void reset() {
        confirmedAt = -1;
    }
}
