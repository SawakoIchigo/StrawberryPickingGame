import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryDir = resolve(dirname(scriptPath), '..');
const runtimeFiles = ['game.js', 'game-core.js', 'visual-layout.js', 'styles.css'];
const normalize = content => content.replace(/\r\n/g, '\n');

export async function buildSite({ sourceDir = repositoryDir, outputDir = join(sourceDir, '_site') } = {}) {
  sourceDir = resolve(sourceDir);
  outputDir = resolve(outputDir);
  const sourceFromOutput = relative(outputDir, sourceDir);
  if (!sourceFromOutput || (!isAbsolute(sourceFromOutput) && sourceFromOutput !== '..' && !sourceFromOutput.startsWith(`..${sep}`))) {
    throw new Error('The build output must not contain the source directory.');
  }

  const contents = Object.fromEntries(await Promise.all(['index.html', ...runtimeFiles].map(async name =>
    [name, normalize(await readFile(join(sourceDir, name), 'utf8'))])));
  // One version covers HTML, every coupled runtime file, and the builder, so
  // both direct and nested module requests always select the same release.
  const hash = createHash('sha256').update(normalize(await readFile(scriptPath, 'utf8')));
  for (const [name, content] of Object.entries(contents)) hash.update(name).update('\0').update(content).update('\0');
  const version = hash.digest('hex').slice(0, 16);
  const names = Object.fromEntries(runtimeFiles.map(name => {
    const extension = extname(name);
    return [name, `${name.slice(0, -extension.length)}.${version}${extension}`];
  }));
  const versionReferences = content => {
    for (const [name, versionedName] of Object.entries(names)) for (const quote of ['"', "'"]) {
      content = content.replaceAll(`${quote}./${name}${quote}`, `${quote}./${versionedName}${quote}`);
    }
    return content;
  };

  // Keep existing output files: local rebuilds need no recursive deletion,
  // and the deployment workflow starts from a clean checkout.
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'index.html'), versionReferences(contents['index.html']));
  for (const name of runtimeFiles) {
    const content = versionReferences(contents[name]);
    await writeFile(join(outputDir, names[name]), content);
    // Older HTML can still request the plain entry. Its nested imports also
    // select this version; already-cached old JavaScript still needs a reload.
    await writeFile(join(outputDir, name), content);
  }
  await copyFile(join(sourceDir, '.nojekyll'), join(outputDir, '.nojekyll'));
  await cp(join(sourceDir, 'assets'), join(outputDir, 'assets'), { recursive: true });
  return { version, files: names };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) await buildSite();
