import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';

if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('当前桌面入口仅验证 Windows x64');
const config = JSON.parse(await readFile('neutralino.config.json', 'utf8'));
const runtime = JSON.parse(await readFile('bin/runtime-version.json', 'utf8'));
if (runtime.version !== config.cli.binaryVersion)
    throw new Error('请先运行 pnpm desktop:setup，安装配置指定的 Neutralino 运行时');

// neu run launches the stock runtime. Brand a separate copy so development also
// shows the app's own process name and icon without modifying the downloaded binary.
const stage = path.resolve('.desktop-build', `dev-${crypto.randomUUID()}`);
await mkdir(stage, { recursive: true });
const executable = path.join(stage, `${config.cli.binaryName}-win_x64.exe`);
await copyFile('bin/neutralino-win_x64.exe', executable);
const require = createRequire(import.meta.url);
const cli = require.resolve('@neutralinojs/neu');
const { patchWindowsExecutable } = require(
    path.resolve(path.dirname(cli), '../src/modules/exepatch.js'),
);
await patchWindowsExecutable(executable);
const result = spawnSync(executable, ['--res-mode=directory', `--path=${process.cwd()}`], {
    stdio: 'inherit',
    windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
