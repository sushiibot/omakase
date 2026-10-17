import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const script = new URL('./publish-update.ts', import.meta.url).pathname;

// Exercise the actual CI script against a local gh stand-in: no token or network is available.
test('publication uploads the APK before announcing it, keeps reruns immutable, and refuses older pointers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'publish-update-test-'));
  try {
    await mkdir(join(dir, 'bin')); await mkdir(join(dir, 'dist'));
    await Bun.write(join(dir, 'dist/omakase.apk'), 'first signed APK');
    await Bun.write(join(dir, 'dist/SHA256SUMS'), 'checksum');
    const db = join(dir, 'releases.json');
    await Bun.write(db, '{}');
    const cli = join(dir, 'bin/gh');
    await Bun.write(cli, `#!${process.execPath}
const [_, command, tag, ...args] = process.argv.slice(2);
const db = process.env.FAKE_RELEASES;
const releases = await Bun.file(db).json();
if(command === 'view') {
 if(!releases[tag]) process.exit(1);
 if(args.includes('--json')) console.log(JSON.stringify({assets:Object.keys(releases[tag]).map(name=>({name}))}));
} else if(command === 'create') {
 if(process.env.FAIL_CREATE === '1') process.exit(1);
 releases[tag] = {};
 for(const path of args) { if(path.startsWith('dist/')) releases[tag][path.slice(5)] = await Bun.file(path).text(); }
} else if(command === 'download') {
 const name=args[args.indexOf('--pattern')+1];
 if(!releases[tag]?.[name]) process.exit(1);
 await Bun.write(args[args.indexOf('--dir')+1]+'/'+name,releases[tag][name]);
} else if(command === 'upload') {
 const path=args[0];
 const manifest=JSON.parse(await Bun.file(path).text());
 if(!releases['android-'+manifest.versionCode]?.['omakase.apk']) process.exit(1);
 releases[tag][path.slice(5)]=await Bun.file(path).text();
} else process.exit(1);
await Bun.write(db,JSON.stringify(releases));
`);
    await chmod(cli, 0o755);
    const run = async (number: number, fail = false) => {
      const child = Bun.spawn([process.execPath, script], { cwd: dir, env: {
        PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, GITHUB_RUN_NUMBER: String(number), GITHUB_SHA: 'a'.repeat(40), FAKE_RELEASES: db,
        ...(fail ? { FAIL_CREATE: '1' } : {}),
      }, stdout: 'ignore', stderr: 'ignore' });
      return child.exited;
    };
    expect(await run(10)).toBe(0);
    const first = await Bun.file(db).json();
    expect(JSON.parse(first['android-latest']['update.json']).versionCode).toBe(11);
    await Bun.write(join(dir, 'dist/omakase.apk'), 'different rerun bytes');
    expect(await run(10)).toBe(0);
    expect((await Bun.file(db).json())['android-11']).toEqual(first['android-11']);
    expect(await run(9)).toBe(0);
    expect((await Bun.file(db).json())['android-latest']).toEqual(first['android-latest']);
    expect(await run(11, true)).not.toBe(0);
    expect((await Bun.file(db).json())['android-latest']).toEqual(first['android-latest']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
