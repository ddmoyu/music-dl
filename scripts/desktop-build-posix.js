import { chmod, copyFile, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { hostTarget } from './desktop-targets.js';
import { SERVICE_VERSION } from '../src/service-version.js';
import { packageLinux } from './package-linux.js';

const target = hostTarget();
const mode = process.argv[2] || 'prepare';
const installed = path.resolve('bin/service', SERVICE_VERSION, 'bundle');
if (
    process.env.MUSIC_SERVICE_BUNDLE &&
    path.resolve(process.env.MUSIC_SERVICE_BUNDLE) !== installed
) {
    await mkdir(path.dirname(installed), { recursive: true });
    await cp(process.env.MUSIC_SERVICE_BUNDLE, installed, {
        recursive: true,
        verbatimSymlinks: true,
    });
}
const service = path.join(installed, 'bin/music-service');
if (
    execFileSync(service, ['version'], { encoding: 'utf8' }).trim() !==
    `music-service ${SERVICE_VERSION}`
)
    throw new Error('后端版本不匹配，请先运行 pnpm service:download 或配置 MUSIC_SERVICE_BUNDLE');
if (mode === 'package') {
    const config = JSON.parse(await readFile('neutralino.config.json', 'utf8'));
    const runtime = JSON.parse(await readFile('bin/runtime-version.json', 'utf8'));
    if (runtime.version !== config.cli.binaryVersion)
        throw new Error('请先运行 pnpm desktop:setup');
    const stage = path.resolve('.desktop-build', `package-${target.id}-${randomUUID()}`);
    await mkdir(path.join(stage, 'bin'), { recursive: true });
    await cp('dist/app', path.join(stage, 'dist/app'), { recursive: true });
    await copyFile(path.join('bin', target.runtime), path.join(stage, 'bin', target.runtimeSlot));
    await chmod(path.join(stage, 'bin', target.runtimeSlot), 0o755);
    const contents =
        target.platform === 'darwin' ? path.join(stage, 'bundle/曲袋.app/Contents') : null;
    const appRoot = contents
        ? path.join(contents, 'Resources')
        : path.join(stage, 'bundle', `qudai-${target.id}`);
    await mkdir(appRoot, { recursive: true });
    const serviceRoot = path.join(appRoot, 'service');
    for (const directory of ['bin', 'lib', 'share/music-service/licenses']) {
        const source = path.join(installed, directory);
        if (await stat(source).catch(() => null))
            await cp(source, path.join(serviceRoot, directory), {
                recursive: true,
                verbatimSymlinks: true,
            });
    }
    const files = [];
    async function record(directory, prefix = '') {
        for (const entry of (await readdir(directory)).sort()) {
            const location = path.join(directory, entry);
            const name = prefix ? `${prefix}/${entry}` : entry;
            if ((await stat(location)).isDirectory()) await record(location, name);
            else {
                const data = await readFile(location);
                files.push({
                    path: name,
                    size: data.length,
                    sha256: createHash('sha256').update(data).digest('hex'),
                });
            }
        }
    }
    await record(serviceRoot);
    config.globalVariables = {
        ...config.globalVariables,
        SHIYIN_SERVICE: { mode: 'sidecar', os: target.os, files },
    };
    config.dataLocation = 'system';
    config.cli.copyItems = [];
    await cp(
        path.join(installed, 'share/music-service/licenses'),
        path.join(stage, 'dist/app/licenses/music-service'),
        { recursive: true },
    );
    await writeFile(path.join(stage, 'neutralino.config.json'), JSON.stringify(config));
    const require = createRequire(import.meta.url);
    const cli = require.resolve('@neutralinojs/neu');
    execFileSync(process.execPath, [cli, 'build'], { cwd: stage, stdio: 'inherit' });
    const built = path.join(stage, 'release/qudai');
    const executable = path.join(appRoot, 'qudai');
    await copyFile(path.join(built, target.neuBinary), executable);
    await chmod(executable, 0o755);
    await copyFile(path.join(built, 'resources.neu'), path.join(appRoot, 'resources.neu'));
    await mkdir('release', { recursive: true });
    let assets;
    if (contents) {
        await mkdir(path.join(contents, 'Resources'), { recursive: true });
        await mkdir(path.join(contents, 'MacOS'), { recursive: true });
        execFileSync('clang', [
            '-Os',
            '-mmacosx-version-min=15.0',
            'scripts/macos-launcher.c',
            '-o',
            path.join(contents, 'MacOS/qudai-launcher'),
        ]);
        execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', executable], {
            stdio: 'inherit',
        });
        const cliRequire = createRequire(cli);
        const icons = cliRequire('png2icons');
        const icon = icons.createICNS(await readFile('dist/app/app-icon.png'), icons.HERMITE, 0);
        if (!icon) throw new Error('无法生成 macOS 图标');
        await writeFile(path.join(contents, 'Resources/app.icns'), icon);
        await writeFile(
            path.join(contents, 'Info.plist'),
            `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>qudai-launcher</string>
<key>CFBundleIdentifier</key><string>${config.applicationId}</string>
<key>CFBundleName</key><string>曲袋</string>
<key>CFBundleDisplayName</key><string>曲袋</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${config.version}</string>
<key>CFBundleVersion</key><string>${config.version}</string>
<key>CFBundleIconFile</key><string>app.icns</string>
<key>LSMinimumSystemVersion</key><string>15.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSApplicationCategoryType</key><string>public.app-category.music</string>
</dict></plist>\n`,
        );
        const app = path.dirname(contents);
        execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', app], {
            stdio: 'inherit',
        });
        execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
        const imageRoot = path.join(stage, 'dmg');
        await mkdir(imageRoot);
        execFileSync('ditto', [app, path.join(imageRoot, '曲袋.app')]);
        execFileSync('ln', ['-s', '/Applications', path.join(imageRoot, 'Applications')]);
        assets = [path.resolve('release', target.assets[0])];
        execFileSync(
            'hdiutil',
            [
                'create',
                '-volname',
                `曲袋 ${config.version}`,
                '-srcfolder',
                imageRoot,
                '-format',
                'UDZO',
                '-fs',
                'HFS+',
                assets[0],
            ],
            { stdio: 'inherit' },
        );
        execFileSync('hdiutil', ['verify', assets[0]], { stdio: 'inherit' });
    } else {
        await copyFile('dist/app/app-icon.png', path.join(appRoot, 'qudai.png'));
        assets = await packageLinux({ target, stage, appRoot, version: config.version });
    }
    await writeFile(
        '.desktop-build/package.json',
        JSON.stringify({
            target: target.id,
            executable,
            resources: path.join(appRoot, 'resources.neu'),
            serviceRoot,
            assets,
        }),
    );
    console.log(`${target.id}：${target.assets[0]}`);
}
