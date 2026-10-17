// Run only after the signed APK build succeeds on main. Publish immutable downloads before the pointer.
import { createHash } from 'node:crypto';
const run = Number(process.env.GITHUB_RUN_NUMBER);
const sha = process.env.GITHUB_SHA;
if (!Number.isSafeInteger(run) || run < 1 || !sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Missing CI build identity');
const code = run + 1;
const tag = `android-${code}`;
const gh = async (...args: string[]) => {
  const result = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'inherit' });
  const output = await new Response(result.stdout).text();
  if (await result.exited) throw new Error(`gh ${args[0]} failed`);
  return output;
};
const exists = async (tag: string) => {
  const process = Bun.spawn(['gh', 'release', 'view', tag], { stdout: 'ignore', stderr: 'ignore' });
  return await process.exited === 0;
};
// A rerun must not replace a published APK (nor its checksum) under the same version.
if (!await exists(tag)) {
  const apk = await Bun.file('dist/omakase.apk').arrayBuffer();
  await Bun.write('dist/update.json', JSON.stringify({
    versionCode: code,
    versionName: `1.0.${run}`,
    url: `https://github.com/sushiibot/omakase/releases/download/${tag}/omakase.apk`,
    sha256: createHash('sha256').update(new Uint8Array(apk)).digest('hex'),
  }));
  await gh('release', 'create', tag, 'dist/omakase.apk', 'dist/SHA256SUMS', 'dist/update.json',
    '--target', sha, '--title', `Android 1.0.${run}`, '--notes', 'Signed personal Android build. Web updates are delivered separately.', '--latest=false');
} else {
  await gh('release', 'download', tag, '--pattern', 'update.json', '--dir', 'dist', '--clobber');
}
if (!await exists('android-latest')) {
  await gh('release', 'create', 'android-latest', '--target', sha, '--title', 'Android update channel',
    '--notes', 'Latest Android update metadata. APK downloads use immutable versioned releases.', '--latest=false');
}
const directory = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/omakase-release-'));
try {
  // Missing pointer is expected on the first release. Fail on other download errors.
  const assets = JSON.parse(await gh('release', 'view', 'android-latest', '--json', 'assets')).assets;
  if (assets.some((asset: { name: string }) => asset.name === 'update.json')) {
    await gh('release', 'download', 'android-latest', '--pattern', 'update.json', '--dir', directory);
    const previous = await Bun.file(`${directory}/update.json`).json();
    if (previous.versionCode > code) process.exit(0);
  }
  await gh('release', 'upload', 'android-latest', 'dist/update.json', '--clobber');
} finally { await import('node:fs/promises').then(fs => fs.rm(directory, { recursive: true, force: true })); }
