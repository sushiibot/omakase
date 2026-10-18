package app.omakase.mobile;

import static org.junit.Assert.*;
import androidx.documentfile.provider.TestDocument;
import androidx.documentfile.provider.DocumentFile;
import java.io.IOException;
import java.util.LinkedHashMap;
import org.junit.Test;

public class DeviceFsTest {
    @Test public void createsMissingParentsAndReusesExistingDirectories() throws Exception {
        TestDocument root = new TestDocument("root", true);
        DocumentFile first = DeviceFsPlugin.directories(root, DeviceFsPlugin.parts("Voting/2026"), 2);
        assertEquals("2026", first.getName());
        assertSame(first, DeviceFsPlugin.directories(root, DeviceFsPlugin.parts("Voting/2026"), 2));
        assertSame(root, DeviceFsPlugin.directories(root, new String[0], 0));
        assertEquals(1, root.listFiles().length);
    }
    @Test public void refusesFileAsParentAndProviderCreationFailure() throws Exception {
        TestDocument root = new TestDocument("root", true);
        root.children.put("file", new TestDocument("file", false));
        try { DeviceFsPlugin.directories(root, new String[]{"file", "child"}, 2); fail(); }
        catch (IOException expected) { }
        root.writable = false;
        try { DeviceFsPlugin.directories(root, new String[]{"new"}, 1); fail(); }
        catch (IOException expected) { }
    }
}
