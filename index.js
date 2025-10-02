import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import core from '@actions/core';
import exec from '@actions/exec';
import { globSync } from 'glob';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const testDir = fs.mkdtempSync(`${os.tmpdir()}/test-pkg-`);

const steps = [
  { name: 'Pack the library', fn: packLibrary },
  { name: 'Install the library', fn: installLibrary },
  { name: 'Verify exports', fn: verifyExports },
  { name: 'Check published files', fn: checkPublishedFiles },
];

async function packLibrary() {
  core.info('Running `npm pack`');
  await exec.exec('npm', ['pack']);
}

async function installLibrary() {
  core.info('Creating a new empty project');
  await exec.exec('npm', ['init', '-y'], { cwd: testDir });

  core.info('Installing the package');
  const tgzPath = path.resolve(getTgzName());
  await exec.exec('npm', ['install', tgzPath], { cwd: testDir });
}

async function verifyExports() {
  core.info('Detecting package exports');
  const exports = packageJson.exports
    ? validateExports(packageJson.exports)
    : validateMain(packageJson.main);

  for (const { key, type } of exports) {
    const isMain = key === '.';
    core.info(`Testing ${isMain ? 'main' : `${key} subpath`} export`);
    const specifier = isMain
      ? packageJson.name
      : `${packageJson.name}/${key.slice(2)}`;
    const importAttributes =
      type === 'json' ? ', { with: { type: "json" } }' : '';
    await exec.exec(
      'node',
      [
        '-e',
        `import(${JSON.stringify(specifier)}${importAttributes}).then(console.log)`,
      ],
      { cwd: testDir },
    );
  }
}

async function checkPublishedFiles() {
  const forbiddenFiles = ['**/__tests__', '**/*.test.*', '**/*.stories.*'];
  core.info(
    `Looking for forbidden files with patterns: ${forbiddenFiles.join(', ')}`,
  );
  const foundFiles = globSync(forbiddenFiles, {
    includeChildMatches: false,
    ignore: 'node_modules/**',
    dot: true,
    cwd: path.join(testDir, 'node_modules', packageJson.name),
  });
  core.info(`Found ${foundFiles.length} forbidden files`);
  if (foundFiles.length > 0) {
    core.info(foundFiles.join('\n'));
    throw new Error(
      'Found forbidden files in the package. This is usually caused by a missing .npmignore or a wrong "files" package.json field',
    );
  }
}

for (const step of steps) {
  const success = await core.group(step.name, async () => {
    try {
      await step.fn();
      return true;
    } catch (error) {
      core.setFailed(error.message);
      return false;
    }
  });
  if (!success) {
    break;
  }
}

function getTgzName() {
  let transformedName = packageJson.name;
  if (transformedName.startsWith('@')) {
    transformedName = transformedName.replace('@', '').replace('/', '-');
  }
  return `${transformedName}-${packageJson.version}.tgz`;
}

function validateExports(exports) {
  if (typeof exports === 'string') {
    throw new Error(
      `The "exports" field must be an object, not a string. Use { ".": ${JSON.stringify(exports)} } instead`,
    );
  }
  if (typeof exports === 'object' && exports !== null) {
    const objectExports = Object.keys(exports);
    if (objectExports.length === 0) {
      throw new Error('There must be at least one export');
    }
    return objectExports
      .filter((key) => !key.includes('*'))
      .map((key) => {
        if (key !== '.' && !key.startsWith('./')) {
          throw new Error(
            `Invalid exports key: "${key}". It must be "." or start with "./"`,
          );
        }
        return { key, type: key.endsWith('.json') ? 'json' : 'js' };
      });
  }
  throw new Error('Invalid "exports" type. It must be an object');
}

function validateMain(main) {
  if (!main) {
    throw new Error('Found no "exports" nor "main" field in package.json');
  }
  if (typeof main !== 'string') {
    throw new Error(`The "main" field in package.json must be a string`);
  }
  return [{ key: '.', type: 'js' }];
}
