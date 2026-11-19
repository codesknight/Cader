import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
const args = process.argv.slice(2);
if (process.platform !== 'win32' || args.length !== 2 || args[0] !== '--bin-dir') {
  console.log('Windows: pnpm.cmd run cli:install --bin-dir <existing-directory-on-PATH>\nOther platforms: link/install apps/cli using its package bin.');
  process.exitCode = 2;
} else {
  const directory = resolve(args[1]);
  if (/["\r\n%]/.test(directory + process.cwd())) throw new Error('Unsupported launcher path');
  await mkdir(directory, { recursive: true });
  const target = join(directory, 'cader.cmd');
  if (existsSync(target) && !(await readFile(target, 'utf8')).includes('Cader local launcher')) throw new Error('Existing cader.cmd is not owned by this installer');
  if (existsSync(join(directory, 'cader.ps1'))) throw new Error('Existing cader.ps1 may shadow the CMD launcher; inspect it before installation');
  const root = process.cwd();
  const portable = join(root, '.cader/tools/node-v24.9.0-win-x64/node.exe');
  const bin = join(root, 'apps/cli/bin/cader.cjs');
  await writeFile(target, `@echo off\r\nrem Cader local launcher\r\nif exist "${portable}" (\r\n  "${portable}" "${bin}" %*\r\n) else (\r\n  node "${bin}" %*\r\n)\r\n`);
  console.log(`Installed ${target}. PATH and PowerShell execution policy were not changed.`);
}
