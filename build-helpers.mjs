// @ts-check
/* eslint-env es2022 */
import { execSync } from 'child_process';
import esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import glob from 'glob';
import { dirname } from 'path';

/** @type {Record<string,unknown>} */
export const opts = process.argv.slice(2).reduce((map, arg) => {
  const [key, value] = arg.replace(/^-+/, '').split('=');
  map[key] = value == null ? true : value;
  return map;
}, {});

export const testsDir = '__tests';
export const distDir = '_npm-lib';
export const srcDir = 'src';

// ---------------------------------------------------------------------------

export const exit1 = (err) => {
  const message = 'message' in err ? err.message : err;
  console.error(message);

  process.exit(1);
};

// ---------------------------------------------------------------------------

const makePackageJson = (
  /** @type {Record<string, unknown>} */ pkg,
  /** @type {string} */ outDir,
  /** @type {Record<string, unknown> | undefined} */ extraFields
) => {
  const newPkg = { ...pkg };
  const { publishConfig } = newPkg;
  delete newPkg.publishConfig;

  delete newPkg.scripts;
  delete newPkg.hxmstyle;
  delete newPkg.private;
  delete newPkg.devDependencies;
  Object.assign(newPkg, publishConfig, extraFields);

  writeFileSync(outDir + '/package.json', JSON.stringify(newPkg, null, '\t'));
};

// ---------------------------------------------------------------------------

let fileMem = {};

const writeOnlyAffected =
  (/** @type {boolean} */ stripHashPrefix) =>
  (/** @type {esbuild.BuildResult} */ res, /** unknown */ err) => {
    if (err) {
      return;
    }
    const { outputFiles = [] } = res;
    const newFiles = {};
    outputFiles
      .filter(({ path }) => !fileMem[path])
      .forEach(({ path, text }) => {
        const targetDir = dirname(path);
        newFiles[path] = 1;
        if (stripHashPrefix) {
          path = path.replace(/(^|\/)\$\$[A-Z0-9]+\$\$-/, '$1');
        }
        return access(targetDir)
          .catch(() => mkdir(targetDir, { recursive: true }))
          .then(() => writeFile(path, text));
      });
    // map this set of outputFiles as the fileMem for next time
    fileMem = {};
    outputFiles.forEach(({ path }) => {
      fileMem[path] = 1;
    });
  };

// ---------------------------------------------------------------------------

const [pkg, rootPkg] = await Promise.all([
  readFile('./package.json').then((str) => JSON.parse(str.toString())),
  readFile('../../package.json').then((str) => JSON.parse(str.toString())),
]);

export const externalDeps = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(rootPkg.dependencies || {}),
  ...Object.keys(rootPkg.devDependencies || {}),
].filter((name) => !name.startsWith('@reykjavik/hanna-'));

// ---------------------------------------------------------------------------

/** @typedef {{ compilerOptions?: Record<string, unknown>; include: string[]; exlude?: string[] }}  TSConfig */
const tscBuild = (
  /** @type {string} */ name,
  /** @type {TSConfig | undefined} */ config
) => {
  const cfgFile = `tsconfig.build.${name}.json`;
  writeFileSync(
    cfgFile,
    `// This file is auto-generated by build.mjs\n${JSON.stringify(
      { extends: './tsconfig.json', ...config },
      null,
      '\t'
    )}`
  );
  try {
    execSync(`yarn run -T tsc --project ${cfgFile}`);
  } catch (err) {
    exit1(new Error(err.output.toString()));
  }
};

// ---------------------------------------------------------------------------

export const buildTests = () => {
  execSync(`rm -rf ${testsDir} && mkdir ${testsDir}`);

  const globPrefix = `${srcDir}/**/*.tests.`;
  if (!opts.dev) {
    tscBuild('tests', {
      compilerOptions: { noEmit: true },
      include: [`${globPrefix}ts`],
    });
  }

  esbuild
    .build({
      bundle: true,
      external: externalDeps,
      format: 'cjs',
      platform: 'node',
      target: ['node16'],
      entryPoints: glob.sync(`${globPrefix}{js,ts,tsx}`),
      entryNames: '[dir]/$$[hash]$$-[name]',
      write: false,
      watch: !!opts.dev && {
        onRebuild: (err, results) => results && writeOnlyAffected(true)(results, err),
      },
      outdir: testsDir,
    })
    .then(writeOnlyAffected(true))
    .catch(exit1);
};

// ---------------------------------------------------------------------------

const addReferenePathsToIndex = (
  /** @type {Array<string>} */ entryPoints,
  /** @type {string} */ distFolder
) => {
  const dtsify = (tsFilePath) => tsFilePath.replace(/\.(tsx?)$/, '.d.$1');
  const indexTsFile = entryPoints.find((filePath) =>
    /(?:^|\/)index.tsx?$/.test(filePath)
  );

  if (indexTsFile) {
    const extraEntryPaths = entryPoints
      .filter((filePath) => filePath !== indexTsFile)
      .map(dtsify)
      .map((declFile) => `/// <reference path="./${declFile}" />`);
    if (extraEntryPaths.length > 0) {
      const indexDeclFile = `${distFolder}/${dtsify(indexTsFile)}`;
      const indexDecls =
        extraEntryPaths.join('\n') + `\n\n` + readFileSync(indexDeclFile);
      writeFileSync(indexDeclFile, indexDecls);
    }
  }
};

// ---------------------------------------------------------------------------

/** @typedef {{ src?: string, cpCmds?: Array<string>, entryGlobs?: Array<string>, sideEffects?: boolean }}  BuildOpts */
/** @type {(libName: string, custom?: BuildOpts) => void} */
export const buildNpmLib = (libName, custom) => {
  const {
    src = srcDir,
    cpCmds = [`cp README.md  CHANGELOG.md ${distDir}`],
    entryGlobs = [`*.{ts,tsx}`],
    sideEffects = false,
  } = custom || {};

  const entryPoints = entryGlobs.flatMap((entryGlob) =>
    glob.sync(entryGlob, {
      cwd: src,
      ignore: ['**/*.{tests,privates}.{ts,tsx}', '**/_*'],
    })
  );

  if (!opts.dev) {
    if (!libName) {
      throw new Error('`libName` argument is required');
    }
    execSync(
      [`rm -rf ${distDir}`, `mkdir ${distDir}`].concat(cpCmds).join(' && ')
      // [`rm -rf ${distDir}`, `mkdir ${distDir} ${distDir}/esm`].concat(cpCmds).join(' && ')
    );
    // writeFile(`${distDir}/esm/package.json`, JSON.stringify({ type: 'module' }));

    makePackageJson(pkg, distDir, {
      sideEffects,
      // exports: entryPoints.reduce((exports, file) => {
      //   const token = file.replace(/\.tsx?$/, '');
      //   const expToken = token === 'index' ? '.' : `./${token}`;
      //   exports[expToken] = {
      //     import: `./esm/${token}.js`,
      //     require: `./${token}.js`,
      //   };
      //   return exports;
      // }, {}),
    });

    // -------
    [
      { name: 'cjs', module: 'commonjs' },
      // { name: 'esm', module: 'esnext' },
    ].forEach(({ name, module }) => {
      const tempOutDir = `${distDir}/temp`;
      const tempLibRoot = `${tempOutDir}/hanna-${libName}/${src}`;
      tscBuild(`lib-${name}`, {
        compilerOptions: {
          module,
          declaration: true,
          outDir: tempOutDir,
        },
        include: entryPoints.map((file) => `${src}/${file}`),
      });
      addReferenePathsToIndex(entryPoints, tempLibRoot);

      const rootDir = module === 'esnext' ? 'esm' : '.';
      execSync(
        [
          `mv ${tempLibRoot}/* ${distDir}/${rootDir}`,
          `rm -rf ${tempOutDir}`,
          // …
        ].join(' && ')
      );
    });
    return;
  } else {
    execSync(`rm -rf ${distDir}`);
  }
};
