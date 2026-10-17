package androidx.documentfile.provider;
import android.net.Uri;
import java.util.LinkedHashMap;
public class TestDocument extends DocumentFile {
        final String name;
        final boolean directory;
        public boolean writable = true;
        public final LinkedHashMap<String, TestDocument> children = new LinkedHashMap<>();
        public TestDocument(String name, boolean directory) { super(null); this.name = name; this.directory = directory; }
        public DocumentFile createDirectory(String name) {
            if (!directory || !writable) return null;
            TestDocument child = new TestDocument(name, true); children.put(name, child); return child;
        }
        public DocumentFile createFile(String mime, String name) { return null; }
        public Uri getUri() { return null; }
        public String getName() { return name; }
        public String getType() { return null; }
        public boolean isDirectory() { return directory; }
        public boolean isFile() { return !directory; }
        public boolean isVirtual() { return false; }
        public long lastModified() { return 0; }
        public long length() { return 0; }
        public boolean canRead() { return true; }
        public boolean canWrite() { return writable; }
        public boolean delete() { return false; }
        public boolean exists() { return true; }
        public DocumentFile[] listFiles() { return children.values().toArray(new DocumentFile[0]); }
        public boolean renameTo(String name) { return false; }
    }
