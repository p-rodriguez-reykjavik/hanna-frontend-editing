/* eslint-env es2022 */
import { execSync } from 'child_process';
import { compileCSSFromJS } from 'es-in-css/compiler';
import esbuild from 'esbuild';
import { readFile } from 'fs/promises';
import globPkg from 'glob';

import { buildNpmLib, buildTests, exit1, isNewFile, opts } from '../../build-helpers.mjs';

import { devDistCssFolder } from './scripts/config.js';

const glob = globPkg.sync;

const [rootPkg, pkg] = await Promise.all([
  readFile('../../package.json').then((str) => JSON.parse(str)),
  readFile('./package.json').then((str) => JSON.parse(str)),
]);

// ---------------------------------------------------------------------------

const distDir = '_npm-lib';

const baseOpts = {
  bundle: true,
  platform: 'node',
  target: ['node16'],
  format: 'cjs',
  watch: opts.dev,
};
const allDeps = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(rootPkg.dependencies || {}),
  ...Object.keys(rootPkg.devDependencies || {}),
];
const externalDeps = allDeps.filter((name) => !name.startsWith('@reykjavik/hanna-'));

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
// poor man's tsc replace-string plugin
['.', 'esm'].forEach((folder) => {
  const fileName = `${distDir}/${folder}/cssutils.js`;
  readFile(fileName).then((contents) => {
    contents.toString().replace(/process\.env\.NPM_PUB/g, 'true');
  });
});

// ---------------------------------------------------------------------------

if (!opts.onlyLib) {
  //
  // ---------------------------------------------------------------------------
  // Build CSS/SCSS files

  const toCSSSources = (res) =>
    res.outputFiles
      .filter(isNewFile)
      .map((res) => ({ fileName: res.path, content: res.text }));

  const cssCompile = (results) =>
    compileCSSFromJS(toCSSSources(results), {
      outbase: 'src/css',
      outdir: devDistCssFolder,
      redirect: (outFile) => outFile.replace(/\/\$\$.+?\$\$-/, '/'),
      minify: process.env.NODE_ENV === 'production',
      prettify: process.env.NODE_ENV !== 'production',
    });

  esbuild
    .build({
      ...baseOpts,
      external: externalDeps,
      entryPoints: glob('src/css/**/*.css.ts'),
      entryNames: '[dir]/$$[hash]$$-[name]',
      outbase: 'src/css',
      outdir: 'src/css',
      write: false,
      watch: opts.dev && {
        onRebuild: (error, results) => {
          if (!error) {
            cssCompile(results);
          }
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      },
    })
    .then(cssCompile)
    // FIXME: cleanup temporary .js files on error
    .catch(exit1);

  // -------------------

  const scssCompile = (results) =>
    compileCSSFromJS(toCSSSources(results), {
      ext: 'scss',
      redirect: (outFile) => outFile.replace(/\/\$\$.+?\$\$-/, '/'),
      banner: '// This file is auto-generated. DO NOT EDIT!\n',
    });

  esbuild
    .build({
      ...baseOpts,
      external: externalDeps,
      entryPoints: glob('src/css/**/*.scss.ts'),
      entryNames: '[dir]/$$[hash]$$-[name]',
      outbase: 'src/css',
      outdir: 'src/css',
      watch: opts.dev && {
        onRebuild: (error, results) => {
          if (!error) {
            return scssCompile(results);
          }
        },
      },
      write: false,
    })
    .then(scssCompile)
    // FIXME: cleanup temporary .js files on error
    .catch(exit1);
}
