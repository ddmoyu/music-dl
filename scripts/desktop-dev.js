import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';
import { hostTarget } from './desktop-targets.js';

const target = hostTarget();
const config = JSON.parse(await readFile('neutralino.config.json', 'utf8'));
const runtime = JSON.parse(await readFile('bin/runtime-version.json', 'utf8'));
if (runtime.version !== config.cli.binaryVersion)
    throw new Error('请先运行 pnpm desktop:setup，安装配置指定的 Neutralino 运行时');

// neu run launches the stock runtime. Brand a separate copy so development also
// shows the app's own process name and icon without modifying the downloaded binary.
const stage = path.resolve('.desktop-build', `dev-${crypto.randomUUID()}`);
await mkdir(stage, { recursive: true });
const executable = path.join(
    stage,
    target.platform === 'win32' ? `${config.cli.binaryName}-win_x64.exe` : config.cli.binaryName,
);
await copyFile(path.join('bin', target.runtime), executable);
const require = createRequire(import.meta.url);
const cli = require.resolve('@neutralinojs/neu');
const { patchWindowsExecutable } = require(
    path.resolve(path.dirname(cli), '../src/modules/exepatch.js'),
);
if (target.platform === 'win32') await patchWindowsExecutable(executable);
else {
    const { chmod } = await import('node:fs/promises');
    await chmod(executable, 0o755);
}
const result = spawnSync(executable, ['--res-mode=directory', `--path=${process.cwd()}`], {
    stdio: 'inherit',
    windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
