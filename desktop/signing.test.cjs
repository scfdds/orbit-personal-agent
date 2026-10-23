const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, copyFile, symlink, rm, realpath } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const plist = (name, id, type = 'APPL') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>${name}</string>
<key>CFBundleIdentifier</key><string>${id}</string><key>CFBundlePackageType</key><string>${type}</string>
<key>CFBundleVersion</key><string>1</string></dict></plist>`;

test('local signing repairs a nested app, seals native resources and detects later changes', { skip: process.platform !== 'darwin' }, async () => {
  const { collectSigningTargets, signLocalMacApp } = await import('../scripts/desktop-sign.mjs');
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'orbit-sign-test-')));
  try {
    const source = join(temp, 'main.c');
    const binary = join(temp, 'fixture');
    await writeFile(source, 'int main(void) { return 0; }\n');
    const compiled = spawnSync('/usr/bin/clang', [source, '-o', binary], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    const app = join(temp, 'Fixture.app');
    const child = join(app, 'Contents/Frameworks/Child.app');
    for (const [bundle, name, id] of [[app, 'Fixture', 'test.orbit.signing'], [child, 'Child', 'test.orbit.signing.child']]) {
      await mkdir(join(bundle, 'Contents/MacOS'), { recursive: true });
      await writeFile(join(bundle, 'Contents/Info.plist'), plist(name, id));
      await copyFile(binary, join(bundle, 'Contents/MacOS', name));
    }
    const framework = join(app, 'Contents/Frameworks/FixtureKit.framework');
    await mkdir(join(framework, 'Versions/A/Resources'), { recursive: true });
    const library = spawnSync('/usr/bin/clang', ['-dynamiclib', source, '-o', join(framework, 'Versions/A/FixtureKit')], { encoding: 'utf8' });
    assert.equal(library.status, 0, library.stderr);
    await writeFile(join(framework, 'Versions/A/Resources/Info.plist'), plist('FixtureKit', 'test.orbit.signing.framework', 'FMWK'));
    await symlink('A', join(framework, 'Versions/Current'));
    await symlink('Versions/Current/FixtureKit', join(framework, 'FixtureKit'));
    await symlink('Versions/Current/Resources', join(framework, 'Resources'));
    const resources = join(app, 'Contents/Resources/app');
    await mkdir(resources, { recursive: true });
    const native = join(resources, 'orbit-wechat-reader');
    await copyFile(binary, native);
    await writeFile(join(resources, 'data.json'), '{"version":1}');

    const targets = await collectSigningTargets(app);
    assert.equal(targets.at(-1), app);
    assert.ok(targets.indexOf(native) < targets.indexOf(child));
    assert.equal(targets.filter(path => path.includes('Versions/Current')).length, 0);
    const finderInfo = spawnSync('/usr/bin/xattr', ['-wx', 'com.apple.FinderInfo', '0000000000000000000000000000000000000000000000000000000000000000', app]);
    assert.equal(finderInfo.status, 0);
    await signLocalMacApp(app, 'test.orbit.signing');
    assert.notEqual(spawnSync('/usr/bin/xattr', ['-p', 'com.apple.FinderInfo', app]).status, 0);
    const verified = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    const details = spawnSync('/usr/bin/codesign', ['-dv', app], { encoding: 'utf8' });
    assert.match(details.stderr, /Identifier=test\.orbit\.signing/);
    assert.match(details.stderr, /Signature=adhoc/);
    assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--strict', native]).status, 0);

    await writeFile(join(resources, 'data.json'), '{"version":2}');
    const changed = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' });
    assert.notEqual(changed.status, 0, 'post-signing changes must invalidate the resource seal');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
