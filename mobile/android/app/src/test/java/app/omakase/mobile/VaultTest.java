package app.omakase.mobile;
import static org.junit.Assert.*;
import org.junit.Test;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
public class VaultTest {
    @Test public void pathsStayInsideVisibleVault() throws Exception {
        assertArrayEquals(new String[]{"Projects", "Note.md"}, ObsidianVaultPlugin.parts("Projects/Note.md"));
        assertEquals(0, ObsidianVaultPlugin.parts(".").length);
        for (String path : new String[]{"../note.md", "/note.md", ".obsidian/config", "a/../x", "a//b", "a\\b", "a:b", "a\u0000b", ""}) {
            try { ObsidianVaultPlugin.parts(path); fail(path); } catch (IOException expected) { }
        }
    }
    @Test public void hashesMatchGatewayContract() throws Exception {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ObsidianVaultPlugin.hash(new byte[0]));
        assertNotEquals(ObsidianVaultPlugin.hash("before".getBytes(StandardCharsets.UTF_8)), ObsidianVaultPlugin.hash("after".getBytes(StandardCharsets.UTF_8)));
    }
}
