package bot.sushii.omakase;

import static org.junit.Assert.assertEquals;
import org.junit.Test;
import static bot.sushii.omakase.BackNavigation.Action.*;

public class BackNavigationTest {
    @Test public void historyAndSheetsCloseBeforeExit() {
        BackNavigation back = new BackNavigation();
        assertEquals(BACK, back.press(true, false, 100));
        assertEquals(BACK, back.press(true, true, 200));
        assertEquals(CONFIRM, back.press(false, true, 300));
        assertEquals(EXIT, back.press(false, true, 400));
    }

    @Test public void exhaustedDeepLinkReturnsHomeBeforeConfirmation() {
        BackNavigation back = new BackNavigation();
        assertEquals(HOME, back.press(false, false, 100));
        assertEquals(CONFIRM, back.press(false, true, 200));
        assertEquals(EXIT, back.press(false, true, 300));
    }

    @Test public void confirmationExpiresAndResetsWhenLeaving() {
        BackNavigation back = new BackNavigation();
        assertEquals(CONFIRM, back.press(false, true, 100));
        assertEquals(CONFIRM, back.press(false, true, 2100));
        back.reset();
        assertEquals(CONFIRM, back.press(false, true, 2200));
        assertEquals(BACK, back.press(true, false, 2300));
        assertEquals(CONFIRM, back.press(false, true, 2400));
    }
}
