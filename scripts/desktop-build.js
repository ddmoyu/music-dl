import { copyFile, mkdir, stat, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';
if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('当前打包入口仅验证 Windows x64；其他平台需提供对应服务和运行时。');
const mode = process.argv[2] || 'prepare';
const target = path.resolve('bin/service/music-service.exe');
const source = process.env.MUSIC_SERVICE_BINARY || process.argv[3];
await mkdir(path.dirname(target), { recursive: true });
if (source && path.resolve(source) !== target) await copyFile(source, target);
try {
    await stat(target);
} catch {
    throw new Error(
        '缺少 music-service。先设置 MUSIC_SERVICE_BINARY 为已构建的后端可执行文件路径，再运行桌面命令。',
    );
}
const version = spawnSync(target, ['version'], { encoding: 'utf8', windowsHide: true });
if (version.status !== 0) throw new Error('music-service 无法运行');
console.log(version.stdout.trim());
if (mode === 'package') {
    const config = JSON.parse(await readFile('neutralino.config.json', 'utf8'));
    const runtime = JSON.parse(
        await readFile('bin/runtime-version.json', 'utf8').catch(() => '{}'),
    );
    if (runtime.version !== config.cli.binaryVersion)
        throw new Error('请先运行 pnpm desktop:setup，安装配置指定的 Neutralino 运行时');
    // neu archives and removes its entire .tmp directory. Isolate its workspace
    // so development databases, tokens and screenshots cannot enter the bundle.
    const stage = path.resolve('.desktop-build', crypto.randomUUID());
    await mkdir(path.join(stage, 'bin'), { recursive: true });
    await cp('dist/app', path.join(stage, 'dist/app'), { recursive: true });
    await copyFile('bin/neutralino-win_x64.exe', path.join(stage, 'bin/neutralino-win_x64.exe'));
    await mkdir(path.join(stage, 'dist/app/service'), { recursive: true });
    const embeddedBinary = path.join(stage, 'dist/app/service/music-service.exe');
    await copyFile(target, embeddedBinary);
    const binaryData = await readFile(embeddedBinary);
    config.globalVariables = {
        ...config.globalVariables,
        SHIYIN_SERVICE: {
            sha256: crypto.createHash('sha256').update(binaryData).digest('hex'),
            size: binaryData.length,
        },
    };
    config.cli.copyItems = [];
    const backendLicenses =
        process.env.MUSIC_SERVICE_LICENSES || path.resolve('bin/service/licenses');
    await stat(path.join(backendLicenses, 'taglib-COPYING.MPL.txt'));
    // Resources, service and notices are all embedded into the final executable.
    await cp(backendLicenses, path.join(stage, 'dist/app/licenses/music-service'), {
        recursive: true,
    });
    await writeFile(path.join(stage, 'neutralino.config.json'), JSON.stringify(config));
    const require = createRequire(import.meta.url);
    const cli = require.resolve('@neutralinojs/neu');
    const result = spawnSync(process.execPath, [cli, 'build', '--embed-resources'], {
        cwd: stage,
        stdio: 'inherit',
        windowsHide: true,
    });
    if (result.status !== 0) throw new Error('桌面打包失败');
    const bundle = path.join(stage, 'release/shiyin');
    const files = await readdir(bundle);
    if (files.length !== 1 || files[0] !== 'shiyin-win_x64.exe')
        throw new Error('单文件构建包含多余文件，已停止发布');
    // neu --release zips before removing resources.neu. Zip the verified final folder instead.
    const cliRequire = createRequire(cli);
    await cliRequire('zip-lib').archiveFolder(bundle, path.join(stage, 'shiyin-release.zip'));
    await mkdir('release', { recursive: true });
    const releaseDirectory = path.resolve('release/shiyin-windows-x64');
    await mkdir(releaseDirectory, { recursive: true });
    await copyFile(path.join(bundle, files[0]), path.join(releaseDirectory, files[0]));
    // Remove only known obsolete build artifacts, preserving user-created files and data.
    for (const name of ['licenses', 'bin', 'resources.neu']) {
        const legacy = path.resolve(releaseDirectory, name);
        if (path.dirname(legacy) !== releaseDirectory) throw new Error('无效的清理路径');
        await rm(legacy, { recursive: true, force: true });
    }
    await copyFile(path.join(stage, 'shiyin-release.zip'), 'release/shiyin-windows-x64.zip');
    console.log('Windows x64: release/shiyin-windows-x64.zip');
}
