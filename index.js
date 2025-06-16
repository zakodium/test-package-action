import core from '@actions/core';
import exec from '@actions/exec';

core.info('Packing the library');
await exec.exec('npm', ['pack']);
