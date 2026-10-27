import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, readlink, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';
import { startService } from './local-service.js';
import { Api } from '../src/api.js';
import { SERVICE_VERSION } from '../src/service-version.js';
import { hostTarget } from './desktop-targets.js';

const target = hostTarget();
const require = createRequire(createRequire(import.meta.url).resolve('@neutralinojs/neu'));
const asar = require('@electron/asar');
const packaged = JSON.parse(await readFile('.desktop-build/package.json', 'utf8'));
assert.equal(packaged.target, target.id);
const directory = path.resolve(
    '.desktop-build',
    `release-smoke-${crypto.randomUUID()}`,
    '解压 测试',
);
await mkdir(directory, { recursive: true });
const installations = [];
if (target.platform === 'win32') {
    await require('zip-lib').extract(
        packaged.assets.find((asset) => asset.endsWith('.zip')),
        directory,
    );
    installations.push({
        format: 'ZIP',
        root: directory,
        executable: path.join(directory, 'qudai-win_x64.exe'),
    });
} else if (target.platform === 'darwin') {
    const mount = path.join(directory, '挂载 点');
    await mkdir(mount);
    execFileSync(
        'hdiutil',
        ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, packaged.assets[0]],
        { stdio: 'inherit' },
    );
    try {
        assert.equal(await readlink(path.join(mount, 'Applications')), '/Applications');
        execFileSync('ditto', [path.join(mount, '曲袋.app'), path.join(directory, '曲袋.app')]);
    } finally {
        execFileSync('hdiutil', ['detach', mount], { stdio: 'inherit' });
    }
    installations.push({
        format: 'DMG',
        root: path.join(directory, '曲袋.app/Contents/Resources'),
        executable: path.join(directory, '曲袋.app/Contents/MacOS/qudai-launcher'),
    });
} else {
    if (process.env.CI !== 'true') throw new Error('deb 安装检查仅允许在隔离 CI 账号运行');
    const deb = packaged.assets.find((asset) => asset.endsWith('.deb'));
    const version = JSON.parse(await readFile('package.json', 'utf8')).version;
    for (const [field, value] of Object.entries({
        Package: 'qudai',
        Version: version,
        Architecture: target.arch === 'x64' ? 'amd64' : 'arm64',
    }))
        assert.equal(
            execFileSync('dpkg-deb', ['-f', deb, field], { encoding: 'utf8' }).trim(),
            value,
        );
    execFileSync('sudo', ['apt-get', 'install', '-y', deb], { stdio: 'inherit' });
    assert.equal(
        execFileSync('dpkg-query', ['-W', '-f=${Version}', 'qudai'], { encoding: 'utf8' }),
        version,
    );
    execFileSync('desktop-file-validate', ['/usr/share/applications/qudai.desktop']);
    installations.push({ format: 'deb', root: '/opt/qudai', executable: '/usr/bin/qudai' });
    const image = packaged.assets.find((asset) => asset.endsWith('.AppImage'));
    const header = await readFile(image);
    assert.equal(header.subarray(8, 11).toString('hex'), '414902');
    assert.equal(header.readUInt16LE(18), target.arch === 'arm64' ? 183 : 62);
    execFileSync(image, ['--appimage-extract'], { cwd: directory, stdio: 'ignore' });
    const root = path.join(directory, 'squashfs-root');
    assert((await stat(path.join(root, 'AppRun'))).mode & 0o111);
    execFileSync('desktop-file-validate', [path.join(root, 'qudai.desktop')]);
    installations.push({
        format: 'AppImage',
        root: path.join(root, 'opt/qudai'),
        executable: image,
        env: { APPIMAGE_EXTRACT_AND_RUN: '1' },
    });
}
for (const installation of installations) {
    const appRoot = installation.root;
    const desktop = path.join(appRoot, target.platform === 'win32' ? 'qudai-win_x64.exe' : 'qudai');
    let archive = path.join(appRoot, 'resources.neu');
    if (target.platform === 'win32') {
        const pe = require('pe-library');
        const exe = pe.NtExecutable.from(await readFile(desktop));
        const embedded = pe.NtExecutableResource.from(exe).entries.find(
            (entry) => entry.type === 10 && entry.id === 'NEUTRALINOJS_RESOURCES_NEU',
        );
        assert(embedded, '发行 EXE 必须内嵌 resources.neu');
        await writeFile(archive, Buffer.from(embedded.bin));
    }
    const files = asar.listPackage(archive).map((file) => file.replaceAll('\\', '/'));
    assert(files.includes('/dist/app/index.html'));
    assert(files.includes('/dist/app/licenses/music-service/taglib-COPYING.MPL.txt'));
    assert(files.includes('/dist/app/licenses/neutralino-runtime.txt'));
    assert(files.every((file) => !/(?:^|\/)(?:prototype|\.storage|\.tmp)(?:\/|$)/.test(file)));
    assert(
        files.every((file) => file === '/neutralino.config.json' || /^\/dist(?:\/|$)/.test(file)),
    );
    const config = JSON.parse(asar.extractFile(archive, 'neutralino.config.json'));
    assert.equal(config.version, JSON.parse(await readFile('package.json', 'utf8')).version);
    const manifest = config.globalVariables.SHIYIN_SERVICE;
    let binary;
    if (target.platform === 'win32') {
        const data = asar.extractFile(
            archive,
            path.join('dist', 'app', 'service', 'music-service.exe'),
        );
        assert.equal(data.length, manifest.size);
        assert.equal(crypto.createHash('sha256').update(data).digest('hex'), manifest.sha256);
        assert.deepEqual(data, await readFile(process.env.MUSIC_SERVICE_BINARY));
        binary = path.join(directory, 'music-service.exe');
        await writeFile(binary, data);
    } else {
        assert.equal(manifest.mode, 'sidecar');
        assert.equal(manifest.os, target.os);
        for (const file of manifest.files) {
            const data = await readFile(path.join(appRoot, 'service', file.path));
            assert.equal(data.length, file.size);
            assert.equal(crypto.createHash('sha256').update(data).digest('hex'), file.sha256);
        }
        binary = path.join(appRoot, 'service/bin/music-service');
        assert((await stat(binary)).mode & 0o111, '后端必须保留执行权限');
        assert((await stat(desktop)).mode & 0o111, '桌面程序必须保留执行权限');
        for (const executable of [binary, desktop]) {
            const data = await readFile(executable);
            if (target.platform === 'linux') {
                assert.equal(data.subarray(0, 4).toString('hex'), '7f454c46');
                assert.equal(data[4], 2);
                assert.equal(data.readUInt16LE(18), target.arch === 'arm64' ? 183 : 62);
                const imports = execFileSync('ldd', [executable], { encoding: 'utf8' });
                assert(!imports.includes('not found'), imports);
            } else {
                assert.equal(
                    execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' }).trim(),
                    target.arch === 'arm64' ? 'arm64' : 'x86_64',
                );
                const imports = execFileSync('otool', ['-L', executable], { encoding: 'utf8' });
                assert(!/\/opt\/homebrew\/|\/usr\/local\/|\/Cellar\//.test(imports), imports);
            }
        }
        if (target.platform === 'darwin') {
            execFileSync(
                'codesign',
                ['--verify', '--deep', '--strict', path.join(directory, '曲袋.app')],
                { stdio: 'inherit' },
            );
            const version = execFileSync(
                'plutil',
                [
                    '-extract',
                    'CFBundleShortVersionString',
                    'raw',
                    '-o',
                    '-',
                    path.join(directory, '曲袋.app/Contents/Info.plist'),
                ],
                { encoding: 'utf8' },
            ).trim();
            assert.equal(version, config.version);
        }
    }
    assert.equal(
        execFileSync(binary, ['version'], { encoding: 'utf8', windowsHide: true }).trim(),
        `music-service ${SERVICE_VERSION}`,
    );
    const expected = JSON.parse(await readFile('scripts/release-service.json', 'utf8')).providers;
    const session = await startService({
        binary,
        directory: path.join(directory, `service-data-${installation.format}`),
        origin: 'http://127.0.0.1:5175',
    });
    try {
        const api = new Api(session);
        const providers = (await api.request('/providers', { query: { limit: 100 } })).data.items;
        assert.deepEqual(providers.map((provider) => provider.source).sort(), expected.sort());
        assert((await api.request('/destinations')).data.items.length > 0);
        assert.equal(
            (await api.request('/downloads', { query: { limit: 100 } })).data.items.length,
            0,
        );
        assert.equal((await fetch(`${session.api_base_url}/api/v1/providers`)).status, 401);
        console.log(
            `${target.id} ${installation.format}：安装包、页面、许可、架构、运行库、真实服务及鉴权检查通过`,
        );
    } finally {
        const exited = once(session.child, 'exit');
        session.child.kill();
        await exited;
    }
}
await writeFile(
    '.desktop-build/smoke-package.json',
    JSON.stringify({
        target: target.id,
        installations: installations.map(({ format, executable, env }) => ({
            format,
            executable,
            env,
        })),
    }),
);
