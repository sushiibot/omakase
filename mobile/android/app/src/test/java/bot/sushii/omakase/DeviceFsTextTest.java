package app.omakase.mobile;
import static org.junit.Assert.*;
import org.junit.Test;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
public class DeviceFsTextTest {
    @Test public void pathsStayInsideSelectedFolder() throws Exception {
        assertArrayEquals(new String[]{"Projects", "Note.md"}, DeviceFsPlugin.parts("Projects/Note.md"));
        assertEquals(0, DeviceFsPlugin.parts(".").length);
        assertArrayEquals(new String[]{".config", "settings.json"}, DeviceFsPlugin.parts(".config/settings.json"));
        for (String path : new String[]{"../note.md", "/note.md", "a/../x", "a//b", "a\\b", "a:b", "a\u0000b", ""}) {
            try { DeviceFsPlugin.parts(path); fail(path); } catch (IOException expected) { }
        }
    }
    @Test public void textReadsRejectBinaryWithoutCorruptingIt() throws Exception {
        assertEquals("hello é", DeviceFsPlugin.text("hello é".getBytes(StandardCharsets.UTF_8)));
        for (byte[] bytes : new byte[][]{new byte[]{0, 1}, new byte[]{(byte) 0xff}}) {
            try { DeviceFsPlugin.text(bytes); fail("Binary must use base64"); }
            catch (IOException expected) { assertTrue(expected.getMessage().contains("base64")); }
        }
    }
    @Test public void genericPathsAndEdits() throws Exception {
        assertArrayEquals(new String[]{".config", "app.json"}, DeviceFsPlugin.parts(".config/app.json"));
        assertEquals("one THREE", DeviceFsPlugin.edit("one two", "two", "THREE"));
        assertEquals("one ", DeviceFsPlugin.edit("one two", "two", ""));
        for (String old : new String[]{"", "missing", "a"}) {
            try { DeviceFsPlugin.edit("a a", old, "b"); fail(old); } catch (IOException expected) { }
        }
        try { DeviceFsPlugin.text(new byte[]{(byte) 0xff}); fail(); } catch (IOException expected) { }
        try { DeviceFsPlugin.text(new byte[]{0}); fail(); } catch (IOException expected) { }
    }
    @Test public void hashesMatchGatewayContract() throws Exception {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", DeviceFsPlugin.hash(new byte[0]));
        assertNotEquals(DeviceFsPlugin.hash("before".getBytes(StandardCharsets.UTF_8)), DeviceFsPlugin.hash("after".getBytes(StandardCharsets.UTF_8)));
    }
}
