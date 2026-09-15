import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSite } from '../scripts/build-site.mjs';

test('published HTML and nested modules share a version that changes with every coupled file', async t => {
  const temporaryRoot = resolve(tmpdir());
  const scratch = await mkdtemp(join(temporaryRoot, 'strawberry-build-'));
  t.after(async () => {
    const target = resolve(scratch);
    assert.equal(dirname(target), temporaryRoot);
    assert.ok(basename(target).startsWith('strawberry-build-'));
    await rm(target, { recursive: true, force: true });
  });
  const sourceDir = join(scratch, 'source');
  const outputDir = join(scratch, 'site');
  const source = {
    'index.html': '<link rel="stylesheet" href="./styles.css"><script type="module" src="./game.js"></script>',
    'game.js': 'import { CONFIG } from \'./game-core.js\';\r\nimport { FIELD } from "./visual-layout.js";\r\nexport const state = [CONFIG.initialLives, FIELD.width];',
    'game-core.js': 'export const CONFIG = { initialLives: 3 };',
    'visual-layout.js': 'export const FIELD = { width: 300 };',
    'styles.css': '.berry { color: red; }',
  };
  await mkdir(join(sourceDir, 'assets'), { recursive: true });
  for (const [name, content] of Object.entries(source)) await writeFile(join(sourceDir, name), content);
  await writeFile(join(sourceDir, '.nojekyll'), '');
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await writeFile(join(sourceDir, 'assets', 'game-sprites.png'), image);

  const inspect = async directory => {
    const html = await readFile(join(directory, 'index.html'), 'utf8');
    const entry = html.match(/src="\.\/([^"]+)"/)[1];
    const stylesheet = html.match(/href="\.\/([^"]+)"/)[1];
    const script = await readFile(join(directory, entry), 'utf8');
    const imports = [...script.matchAll(/from ['"]\.\/([^'"]+)['"]/g)].map(match => match[1]);
    const links = [entry, stylesheet, ...imports];
    assert.equal(links.length, 4);
    const versions = links.map(name => {
      const match = name.match(/^(?:game|game-core|visual-layout|styles)\.([a-f0-9]{16})\.(?:js|css)$/);
      assert.ok(match, `${name} must use a versioned cache key`);
      return match[1];
    });
    assert.equal(new Set(versions).size, 1);
    for (const name of links) {
      const content = await readFile(join(directory, name), 'utf8');
      const originalName = name.replace(`.${versions[0]}`, '');
      assert.equal(await readFile(join(directory, originalName), 'utf8'), content, 'plain compatibility copies also use the versioned nested imports');
    }
    assert.equal(await readFile(join(directory, imports[0]), 'utf8'), source['game-core.js']);
    assert.equal(await readFile(join(directory, imports[1]), 'utf8'), source['visual-layout.js']);
    assert.equal(await readFile(join(directory, stylesheet), 'utf8'), source['styles.css']);
    assert.deepEqual(await readFile(join(directory, 'assets', 'game-sprites.png')), image);
    assert.equal(await readFile(join(directory, '.nojekyll'), 'utf8'), '');
    return { links, html, script };
  };

  await buildSite({ sourceDir, outputDir });
  let previous = await inspect(outputDir);
  const repeatedOutput = join(scratch, 'repeated');
  await buildSite({ sourceDir, outputDir: repeatedOutput });
  assert.deepEqual(await inspect(repeatedOutput), previous, 'identical inputs build identically');
  await writeFile(join(sourceDir, 'game.js'), source['game.js'].replace(/\r\n/g, '\n'));
  await buildSite({ sourceDir, outputDir: repeatedOutput });
  assert.deepEqual(await inspect(repeatedOutput), previous, 'checkout line endings do not change the release');

  for (const name of Object.keys(source)) {
    source[name] += name.endsWith('.html') ? '\n<!-- next revision -->' : '\n/* next revision */';
    await writeFile(join(sourceDir, name), source[name]);
    await buildSite({ sourceDir, outputDir });
    const current = await inspect(outputDir);
    assert.ok(current.links.every((link, index) => link !== previous.links[index]), `${name} changes every coupled cache key`);
    previous = current;
  }
  await assert.rejects(buildSite({ sourceDir, outputDir: sourceDir }), /output must not contain the source/);
});
