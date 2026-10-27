import { chmod, copyFile, cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// 官方 continuous 资产也必须匹配固定摘要，更新工具时显式复核。
const tools = {
    x64: {
        arch: 'x86_64',
        tool: '95cbe7cce9717fce90c484e34052ee7c7f1d7635b33c12525b4776826a7d29b6',
        runtime: '617aa77314d57c8b8e4fae9c3f0b35af7b30d5529cb69e98f64f92510ed98a46',
    },
    arm64: {
        arch: 'aarch64',
        tool: 'a595ea34cd6136c7f595e9dcbb16f3e9725d7610efb9e43b38c3c6e86cafc270',
        runtime: '9a72a744d221576c9347ec074243acc5c3c7568896b12714e0e82e9f0bf47900',
    },
};
const desktopEntry = `[Desktop Entry]
Type=Application
Name=曲袋
Comment=轻量桌面音乐下载工具
Exec=qudai
Icon=qudai
Terminal=false
Categories=AudioVideo;Audio;Music;
`;

async function download(url, destination, digest) {
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`打包工具下载失败：${response.status} ${url}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(data).digest('hex') !== digest)
        throw new Error(`打包工具 SHA256 不匹配：${url}`);
    await writeFile(destination, data, { mode: 0o755 });
    await chmod(destination, 0o755);
}

export async function packageLinux({ target, stage, appRoot, version }) {
    const assets = target.assets.map((name) => path.resolve('release', name));
    async function layout(root, launcher) {
        await cp(appRoot, path.join(root, 'opt/qudai'), {
            recursive: true,
            verbatimSymlinks: true,
        });
        for (const folder of [
            'usr/bin',
            'usr/share/applications',
            'usr/share/icons/hicolor/512x512/apps',
        ])
            await mkdir(path.join(root, folder), { recursive: true });
        await writeFile(path.join(root, 'usr/bin/qudai'), launcher, { mode: 0o755 });
        await writeFile(path.join(root, 'usr/share/applications/qudai.desktop'), desktopEntry);
        await copyFile(
            'dist/app/app-icon.png',
            path.join(root, 'usr/share/icons/hicolor/512x512/apps/qudai.png'),
        );
        execFileSync('desktop-file-validate', [
            path.join(root, 'usr/share/applications/qudai.desktop'),
        ]);
    }
    const debRoot = path.join(stage, 'deb');
    await layout(debRoot, '#!/bin/sh\nexec /opt/qudai/qudai "$@"\n');
    await mkdir(path.join(debRoot, 'DEBIAN'));
    await writeFile(
        path.join(debRoot, 'DEBIAN/control'),
        `Package: qudai
Version: ${version}
Architecture: ${target.arch === 'x64' ? 'amd64' : 'arm64'}
Maintainer: ddmoyu <97585153+ddmoyu@users.noreply.github.com>
Section: sound
Priority: optional
Depends: libc6 (>= 2.39), libstdc++6, libgtk-3-0t64, libwebkit2gtk-4.1-0, libayatana-appindicator3-1
Homepage: https://github.com/ddmoyu/music-dl
Description: 曲袋桌面音乐下载工具
 多平台搜索、批量下载与轻量试听，包含本机 music-service。
`,
    );
    execFileSync('dpkg-deb', ['--build', '--root-owner-group', '-Zxz', '-z6', debRoot, assets[0]], {
        stdio: 'inherit',
    });

    const appDir = path.join(stage, '曲袋.AppDir');
    const launcher =
        '#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)\nexec "$root/opt/qudai/qudai" "$@"\n';
    await layout(appDir, launcher);
    await writeFile(
        path.join(appDir, 'AppRun'),
        '#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$root/opt/qudai/qudai" "$@"\n',
        { mode: 0o755 },
    );
    await writeFile(path.join(appDir, 'qudai.desktop'), desktopEntry);
    await copyFile('dist/app/app-icon.png', path.join(appDir, 'qudai.png'));
    await symlink('qudai.png', path.join(appDir, '.DirIcon'));
    const lock = tools[target.arch];
    const tool = path.join(stage, 'appimagetool.AppImage');
    const runtime = path.join(stage, 'appimage-runtime');
    await download(
        `https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${lock.arch}.AppImage`,
        tool,
        lock.tool,
    );
    await download(
        `https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-${lock.arch}`,
        runtime,
        lock.runtime,
    );
    execFileSync(tool, ['--no-appstream', '--runtime-file', runtime, appDir, assets[1]], {
        stdio: 'inherit',
        env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', ARCH: lock.arch, VERSION: version },
    });
    return assets;
}
