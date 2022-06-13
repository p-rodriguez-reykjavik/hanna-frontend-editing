/* eslint-env es2022 */
import { exec as execAsync, execSync } from 'child_process';
import esbuild from 'esbuild';
import { writeFileSync } from 'fs';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import glob from 'glob';
import { dirname } from 'path';

export const opts = process.argv.slice(2).reduce(
  /* <Record<string,unknown>> */ (map, arg) => {
    const [key, value] = arg.replace(/^-+/, '').split('=');
    map[key] = value == null ? true : value;
    return map;
  },
  {}
);

export const testsDir = '__tests';
export const distDir = '_npm-lib';
export const srcDir = 'src';

// ---------------------------------------------------------------------------

export const exit1 = (err) => {
  console.error(err);

  process.exit(1);
};

// ---------------------------------------------------------------------------

export const makePackageJson = (pkg, outdir, extras) => {
  const pkgOverloads = pkg.npm_lib_package_json;
  const newPkg = { ...pkg };
  delete newPkg.npm_lib_package_json;

  delete newPkg.scripts;
  delete newPkg.hxmstyle;
  delete newPkg.private;
  delete newPkg.devDependencies;
  Object.assign(newPkg, pkgOverloads, extras);

  writeFileSync(outdir + '/package.json', JSON.stringify(newPkg, null, '\t'));
};

// ---------------------------------------------------------------------------

const fileMem = {};
const isNewFile = ({ path }) => {
  if (path in fileMem) {
    return false;
  }
  fileMem[path] = true;
  return true;
};

const writeOnlyAffected = (res, err) => {
  if (err) {
    return;
  }
  return res.outputFiles.filter(isNewFile).forEach((res) => {
    const targetDir = dirname(res.path);
    return access(targetDir)
      .catch(() => mkdir(targetDir, { recursive: true }))
      .then(() => writeFile(res.path, res.text));
  });
};

// ---------------------------------------------------------------------------

const [pkg, rootPkg] = await Promise.all([
  readFile('./package.json').then((str) => JSON.parse(str)),
  readFile('../../package.json').then((str) => JSON.parse(str)),
]);

const externalDeps = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(rootPkg.dependencies || {}),
  ...Object.keys(rootPkg.devDependencies || {}),
].filter((name) => !name.startsWith('@reykjavik/hanna-'));

export const buildTests = () => {
  execSync(`rm -rf ${testsDir} && mkdir ${testsDir}`);

  esbuild
    .build({
      bundle: true,
      external: externalDeps,
      format: 'cjs',
      platform: 'node',
      target: ['node16'],
      entryPoints: glob.sync(`${srcDir}**/*.tests.{js,ts,tsx}`),
      entryNames: '[dir]/[name]--[hash]',
      write: false,
      watch: opts.dev && {
        onRebuild: (err, results) => writeOnlyAffected(results, err),
      },
      outdir: testsDir,
    })
    .then(writeOnlyAffected)
    .catch(exit1);
};

// ---------------------------------------------------------------------------

const tscBuild = (name, config, watch) => {
  const cfgFile = `tsconfig.build.${name}.json`;
  writeFileSync(
    cfgFile,
    `// This file is auto-generated by build.mjs\n${JSON.stringify(
      { extends: './tsconfig.json', ...config },
      null,
      '\t'
    )}`
  );
  if (watch) {
    execAsync(`yarn run -T tsc --project ${cfgFile} --watch --preserveWatchOutput`);
  } else {
    execSync(`yarn run -T tsc --project ${cfgFile}`);
  }
};

// ---------------------------------------------------------------------------

export const buildNpmLib = (libName, custom) => {
  const {
    src = srcDir,
    cpCmds = [`cp README.md  CHANGELOG.md ${distDir}`],
    entryGlobs = [`*.{ts,tsx}`],
  } = custom || {};

  const entryPoints = entryGlobs.flatMap((entryGlob) =>
    glob.sync(entryGlob, { cwd: src, ignore: '**/*.tests.{ts,tsx}' })
  );

  if (!opts.dev) {
    if (!libName) {
      throw new Error('`libName` argument is required');
    }
    execSync(
      [`rm -rf ${distDir}`, `mkdir ${distDir} ${distDir}/esm`].concat(cpCmds).join(' && ')
    );
    writeFile(`${distDir}/esm/package.json`, JSON.stringify({ type: 'module' }));

    makePackageJson(pkg, distDir, {
      exports: entryPoints.reduce((exports, file) => {
        const token = file.replace(/\.tsx?$/, '');
        const expToken = token === 'index' ? '.' : `./${token}`;
        exports[expToken] = {
          import: `./esm/${token}.mjs`,
          require: `./${token}.js`,
        };
        return exports;
      }, {}),
    });

    // -------
    [
      { name: 'cjs', module: 'commonjs' },
      { name: 'esm', module: 'esnext' },
    ].forEach(({ name, module }) => {
      tscBuild(`lib-${name}`, {
        compilerOptions: {
          module,
          target: 'ES2015',
          declaration: true,
          outDir: `${distDir}/temp`,
        },
        include: entryPoints.map((file) => `${src}/${file}`),
        exclude: [],
      });
      const rootDir = module === 'esnext' ? 'esm' : '.';
      execSync(
        [
          `mv ${distDir}/temp/hanna-${libName}/${src}/* ${distDir}/${rootDir}`,
          `rm -rf ${distDir}/temp`,
        ].join(' && ')
      );
    });
    return;
  } else {
    execSync(`rm -rf ${distDir}`);
  }
};
