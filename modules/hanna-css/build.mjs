// @ts-check
/* eslint-env es2022 */
import { execSync } from 'child_process';
import { compileCSSFromJS } from 'es-in-css/compiler';
import esbuild from 'esbuild';
import { readFile, writeFile } from 'fs/promises';
import { sync as glob } from 'glob';

import {
  buildNpmLib,
  buildTests,
  distDir,
  exit1,
  externalDeps,
  opts,
  srcDir,
} from '../../build-helpers.mjs';

import { devDistCssFolder, serverFolder } from './scripts/config.js';

const cssSrcDir = `${srcDir}/css`;
const cssSourceExtension = '.css.ts';
const cssModuleFiles = glob(`**/*${cssSourceExtension}`, { cwd: cssSrcDir });

const logError = (err) => {
  if (!opts.dev) {
    exit1(err);
  }
  const message = 'message' in err ? err.message : err;
  console.error(message);
};

// ---------------------------------------------------------------------------

/** @type {import('esbuild').BuildOptions} */
const baseOpts = {
  bundle: true,
  platform: 'node',
  target: ['node16'],
  format: 'cjs',
  watch: !!opts.dev,
};

// ---------------------------------------------------------------------------

/** @param {string} majorCssVersion */
const getCssVersionTokenUnion = (majorCssVersion) => {
  // Read all css majorCssVersion folders currently on the built style server.
  // NOTE: We assume the CSS folder contains only folders.
  const cssVFolders = glob(`v${majorCssVersion}*`, { cwd: `${serverFolder}public/css` });

  /** @type {Record<string, 1>} */
  const cssFoldersPlus = {};

  cssVFolders.forEach((name) => {
    // collect all the version substrings of each version folder
    // ( i.e. turn `"v1.3.4"` into `["v1.3.4", "v1.3", "v1"]` )
    cssFoldersPlus[name] = 1;
    const nameBits = name.split('.');
    let i = nameBits.length - 1;
    while (i > 0) {
      nameBits.pop();
      const shortName = nameBits.join('.');
      if (shortName in cssFoldersPlus) {
        break; // because we're reached already covered territory
      }
      cssFoldersPlus[shortName] = 1;
      i--;
    }
  });

  cssFoldersPlus[`dev-v${majorCssVersion}`] = 1;
  delete cssFoldersPlus.v0; // never a good idea

  return Object.keys(cssFoldersPlus)
    .sort()
    .map((key) => `  | '${key}'`)
    .join('\n');
};

const geCssModuleTokenUnion = async () =>
  cssModuleFiles
    .map((fileName) => fileName.slice(0, -cssSourceExtension.length))
    .map((token) => `  | '${token}'`)
    .join('\n');

/** @param {string} cssVersion */
const createStyleServerInfoTsFile = async (cssVersion) => {
  const majorCssVersion = (cssVersion.match(/^(?:0\.\d+|[1-9]\d*)/) || [''])[0] || '';
  const CssVersionTokenUnion = getCssVersionTokenUnion(majorCssVersion);
  const CssModuleTokenUnion = await geCssModuleTokenUnion();

  await writeFile(
    `${srcDir}/lib/style-server-info.ts`,
    [
      `// This file is auto-generated by build.mjs`,
      ``,
      `export const cssVersion = ${JSON.stringify(cssVersion)};`,
      `export const majorCssVersion = ${JSON.stringify(majorCssVersion)};`,
      ``,
      `export type CssVersionToken =`,
      `${CssVersionTokenUnion};`,
      ``,
      `export type CssModuleToken =`,
      `${CssModuleTokenUnion};`,
      ``,
    ].join('\n')
  );
};

// ---------------------------------------------------------------------------
// Always start by exposing style-server-info from package-server.json
// (because tsc is limited)

await readFile('./package-server.json')
  .then((str) => JSON.parse(str.toString()))
  .then(({ cssVersion }) => createStyleServerInfoTsFile(cssVersion))
  .catch(exit1);

// ---------------------------------------------------------------------------
// Always start by building the iconfont

if (!opts.onlyLib) {
  execSync(`rm -rf ${devDistCssFolder}  &&  mkdir ${devDistCssFolder}`);
}
execSync(`yarn run gulp iconfont`);

//
// ---------------------------------------------------------------------------
// Build Unit Tests and NPM library

buildTests();

buildNpmLib('css', {
  src: 'src/lib',
  cpCmds: [
    `cp README-lib.md ${distDir}/README.md`,
    `cp CHANGELOG-lib.md ${distDir}/CHANGELOG.md`,
  ],
  entryGlobs: ['index.ts'],
});

// ---------------------------------------------------------------------------

if (!opts.onlyLib) {
  execSync(`yarn run gulp compressImages`);

  //
  // ---------------------------------------------------------------------------
  // Build CSS files

  let fileMem = {};
  const toCSSSources = (res) => {
    const outputfiles = res.outputFiles
      .filter(({ path }) => !fileMem[path])
      .map((res) => ({ fileName: res.path, content: res.text }));
    fileMem = {};
    outputfiles.forEach(({ path }) => {
      fileMem[path] = true;
    });
    return outputfiles;
  };

  const cssCompile = (results) =>
    compileCSSFromJS(toCSSSources(results), {
      outbase: cssSrcDir,
      outdir: devDistCssFolder,
      redirect: (outFile) => outFile.replace(/\/\$\$.+?\$\$-/, '/'),
      minify: process.env.NODE_ENV === 'production',
      prettify: process.env.NODE_ENV !== 'production',
      nested: { rootRuleName: 'escape' },
    });

  esbuild
    .build({
      ...baseOpts,
      external: externalDeps,
      entryPoints: cssModuleFiles.map((file) => cssSrcDir + '/' + file),
      entryNames: '[dir]/$$[hash]$$-[name]',
      outbase: cssSrcDir,
      outdir: cssSrcDir,
      write: false,
      watch: !!opts.dev && {
        onRebuild: (error, results) => {
          if (!error) {
            cssCompile(results).catch(logError);
          }
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      },
    })
    .then(cssCompile)
    // FIXME: cleanup temporary .js files on error
    .catch(logError);
}
