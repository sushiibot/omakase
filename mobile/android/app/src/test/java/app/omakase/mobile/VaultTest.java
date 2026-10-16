package app.omakase.mobile;
import static org.junit.Assert.*;
import org.junit.Test;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
public class VaultTest {
    @Test public void pathsStayInsideSelectedFolder() throws Exception {
        assertArrayEquals(new String[]{"Projects", "Note.md"}, ObsidianVaultPlugin.parts("Projects/Note.md"));
        assertEquals(0, ObsidianVaultPlugin.parts(".").length);
        assertArrayEquals(new String[]{".config", "settings.json"}, ObsidianVaultPlugin.parts(".config/settings.json"));
        for (String path : new String[]{"../note.md", "/note.md", "a/../x", "a//b", "a\\b", "a:b", "a\u0000b", ""}) {
            try { ObsidianVaultPlugin.parts(path); fail(path); } catch (IOException expected) { }
        }
    }
    @Test public void textReadsRejectBinaryWithoutCorruptingIt() throws Exception {
        assertEquals("hello é", ObsidianVaultPlugin.text("hello é".getBytes(StandardCharsets.UTF_8)));
        for (byte[] bytes : new byte[][]{new byte[]{0, 1}, new byte[]{(byte) 0xff}}) {
            try { ObsidianVaultPlugin.text(bytes); fail("Binary must use base64"); }
            catch (IOException expected) { assertTrue(expected.getMessage().contains("base64")); }
        }
    }
    @Test public void hashesMatchGatewayContract() throws Exception {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ObsidianVaultPlugin.hash(new byte[0]));
        assertNotEquals(ObsidianVaultPlugin.hash("before".getBytes(StandardCharsets.UTF_8)), ObsidianVaultPlugin.hash("after".getBytes(StandardCharsets.UTF_8)));
    }
}
