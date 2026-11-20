import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
const { version } = await json('package.json');
const base = await json('manifests/base.json');
const icons = Object.values(base.icons);
// Use only named inputs. Never walk the workspace or ship profiles, logs or credentials.
async function archive(target, root, names) {
  const files = {};
  for (const name of names.toSorted()) files[name] = await readFile(join(root, name));
  const out = `artifacts/slack-clipper-${target}-${version}.zip`;
  // ZIP stores local wall time; use a fixed local date, independent of time zone.
  await writeFile(out, zipSync(files, { level: 9, mtime: new Date(2000, 0, 1) }));
  console.log(`${root} -> ${out}`);
}
await mkdir('artifacts', { recursive: true });
for (const browser of ['firefox', 'chrome']) {
  const dir = `dist/${browser}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const opts = { bundle: true, outdir: dir, format: 'iife', target: browser === 'firefox' ? 'firefox140' : 'chrome120' };
  await build({ ...opts, entryPoints: ['src/background.ts', 'src/options.ts'] });
  // executeScript(files) returns the last expression's value from the isolated world.
  await build({ ...opts, entryPoints: ['src/page.ts'], globalName: 'Page', banner: { js: '(() => {' }, footer: { js: 'return Page.extract(document); })();' } });
  await mkdir(join(dir, 'icons'));
  const assets = ['options.html', 'options.css', ...icons];
  for (const name of assets) await cp(`assets/${name}`, join(dir, name));
  await cp('vendor/readability/LICENSE.md', join(dir, 'Readability-LICENSE.txt'));
  await cp('vendor/readability/NOTICE.txt', join(dir, 'Readability-NOTICE.txt'));
  const manifest = { ...base, version, ...await json(`manifests/${browser}.json`) };
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await archive(browser, dir, [...assets, 'manifest.json', 'background.js', 'options.js', 'page.js', 'Readability-LICENSE.txt', 'Readability-NOTICE.txt']);
}
await archive('source', '.', await json('scripts/source-files.json'));
