import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';

// neu update also removes .tmp. Keep all CLI downloads away from user/dev data.
const config = JSON.parse(await readFile('neutralino.config.json', 'utf8'));
const stage = path.resolve('.desktop-build', `setup-${crypto.randomUUID()}`);
await mkdir(stage, { recursive: true });
await writeFile(path.join(stage, 'neutralino.config.json'), JSON.stringify(config));
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('@neutralinojs/neu'), 'update'], {
    cwd: stage,
    stdio: 'inherit',
    windowsHide: true,
});
if (result.status !== 0) throw new Error('Neutralino 运行时下载失败');
const license = await fetch(
    `https://raw.githubusercontent.com/neutralinojs/neutralinojs/v${config.cli.binaryVersion}/LICENSE`,
);
if (!license.ok) throw new Error('Neutralino 许可声明下载失败');
await mkdir('public/licenses', { recursive: true });
await writeFile(
    'public/licenses/neutralino-runtime.txt',
    (await license.text()).replace(/[ \t]+$/gm, ''),
);
await cp(path.join(stage, 'bin'), 'bin', { recursive: true });
await writeFile('bin/runtime-version.json', JSON.stringify({ version: config.cli.binaryVersion }));
console.log(`Neutralino ${config.cli.binaryVersion} 已就绪`);
