#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(path.dirname(fs.realpathSync(__filename)), '../../..');
const [major, minor] = process.versions.node.split('.').map(Number);
let node = process.execPath;
if (major < 24 || (major === 24 && minor < 9)) {
  const portable = path.join(root, '.cader/tools/node-v24.9.0-win-x64/node.exe');
  if (process.platform !== 'win32' || !fs.existsSync(portable)) {
    console.error('Cader requires Node >=24.9.0. Install a supported Node version.'); process.exit(1);
  }
  node = portable;
}
const entry = path.join(root, 'apps/cli/dist/index.js');
if (!fs.existsSync(entry)) {
  console.error('Build Cader first: pnpm.cmd build (Windows) or pnpm build.'); process.exit(1);
}
const child = spawn(node, [entry, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
const interrupt = () => child.kill('SIGINT');
const terminate = () => child.kill('SIGTERM');
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
child.once('error', () => { console.error('Cader could not start. Check the Node executable and build.'); process.exitCode = 1; });
child.once('close', (code, signal) => {
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
