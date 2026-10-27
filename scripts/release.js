import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SERVICE_VERSION } from '../src/service-version.js';
import { targets, hostTarget, releaseFiles } from './desktop-targets.js';

export { releaseFiles };
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function validateTag(tag, version, desktopVersion) {
    if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
        throw new Error('发布 tag 必须为无前导零的 vX.Y.Z');
    if (tag !== `v${version}` || desktopVersion !== version)
        throw new Error('tag、package.json 与 Neutralino 版本不一致');
}

export function changelogEntry(changelog, version) {
    const entries = changelog.replace(/\r\n/g, '\n').split(/^## /m).slice(1);
    const section = entries.find((entry) => entry.startsWith(`${version} - `));
    if (!section || !/^\d{4}-\d{2}-\d{2}\n/.test(section.slice(version.length + 3)))
        throw new Error(`CHANGELOG.md 缺少 ${version} 的带日期条目`);
    const body = section.slice(section.indexOf('\n') + 1).trim();
    if (!body) throw new Error('发布更新日志为空');
    return body;
}

export function downloadTable({ tag, repository }) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('无效的 GitHub 仓库');
    const base = `https://github.com/${repository}`;
    const download = `${base}/releases/download/${tag}`;
    const encodePart = (value) =>
        encodeURIComponent(value.replaceAll('_', '__').replaceAll('-', '--'));
    const groups = [
        [
            'Windows',
            'windows',
            [
                ['EXE', 'x64', '2d7d9a', 'qudai-win_x64.exe'],
                ['ZIP', 'x64', '67b7d1', 'qudai-windows-x64.zip'],
            ],
        ],
        [
            'macOS',
            'apple',
            [
                ['DMG', 'Apple Silicon', '000000', 'qudai-macos-arm64.dmg'],
                ['DMG', 'Intel x64', '00A9E0', 'qudai-macos-x64.dmg'],
            ],
        ],
        [
            'Linux',
            'linux',
            [
                ['deb', 'x64', 'f84e29', 'qudai-linux-x64.deb'],
                ['deb', 'ARM64', 'FF9966', 'qudai-linux-arm64.deb'],
                ['AppImage', 'x64', 'f84e29', 'qudai-linux-x64.AppImage'],
                ['AppImage', 'ARM64', 'FF9966', 'qudai-linux-arm64.AppImage'],
            ],
        ],
    ];
    const rows = groups
        .map(([os, logo, assets]) => {
            const links = assets
                .map(
                    ([kind, architecture, color, name]) =>
                        `        <a href="${download}/${name}"><img src="https://img.shields.io/badge/${encodePart(kind)}-${encodePart(architecture)}-${color}.svg?logo=${logo}" alt="${kind} ${architecture}"></a>`,
                )
                .join('<br>\n');
            return `    <tr>\n      <td>${os}</td>\n      <td>\n${links}\n      </td>\n    </tr>`;
        })
        .join('\n');
    return `<div align="center">\n  <a href="${base}/releases/tag/${tag}"><img src="https://img.shields.io/github/downloads/${repository}/${tag}/total?style=flat-square&amp;logo=github" alt="本版本下载次数"></a>\n</div>\n\n**按系统选择下载：**\n\n<div align="left">\n<table>\n  <thead align="left">\n    <tr><th>系统</th><th>下载</th></tr>\n  </thead>\n  <tbody align="left">\n${rows}\n  </tbody>\n</table>\n</div>\n`;
}

export function releaseNotes({ tag, repository, changes }) {
    const table = downloadTable({ tag, repository });
    const base = `https://github.com/${repository}`;
    const download = `${base}/releases/download/${tag}`;
    return `## 更新内容\n\n${changes}\n\n## 运行要求\n\n- Windows x64：需要 WebView2 运行时，EXE 可直接运行，ZIP 包含同一个 EXE。\n- Linux x64/ARM64：以 Ubuntu 24.04 为基线，需要 GTK 3 与 WebKitGTK 4.1（libwebkit2gtk-4.1-0）。deb 使用 sudo apt install ./文件名.deb 安装；AppImage 添加执行权限后运行。AppImage 同样需要系统 GTK/WebKitGTK，无法使用 FUSE 时可通过 APPIMAGE_EXTRACT_AND_RUN=1 运行。\n- macOS Intel/Apple Silicon：最低 macOS 15，打开 DMG 后将曲袋.app 拖入 Applications。当前仅 ad-hoc 签名，尚无 Developer ID 签名或公证。\n\n跨平台预览版，保留每个平台完整包内布局。音源可用性及账号授权以实际结果为准。旧开发版本数据库不自动迁移，升级前请阅读[数据与兼容性说明](${base}/blob/${tag}/docs/development.md#开发和运行)。\n\n[完整更新日志](${base}/blob/${tag}/CHANGELOG.md) · [SHA256 校验文件](${download}/SHA256SUMS) · [构建与资产报告](${download}/release-manifest.json)\n\n## 下载\n\n${table}`;
}

export async function metadata(tag) {
    const pkg = await json('package.json');
    const desktop = await json('neutralino.config.json');
    const service = await json('scripts/release-service.json');
    validateTag(tag, pkg.version, desktop.version);
    if (service.version !== SERVICE_VERSION || !/^[a-f0-9]{40}$/.test(service.revision))
        throw new Error('发布后端版本或固定提交无效');
    const changes = changelogEntry(await readFile('CHANGELOG.md', 'utf8'), pkg.version);
    const repository = process.env.GITHUB_REPOSITORY || 'ddmoyu/music-dl';
    return {
        tag,
        version: pkg.version,
        repository,
        service,
        changes,
        prerelease: pkg.release?.prerelease === true,
    };
}

export async function verifyAssets(directory, { tag, commit }) {
    const manifest = await json(path.join(directory, 'release-manifest.json'));
    if (manifest.tag !== tag || manifest.commit !== commit || manifest.version !== tag.slice(1))
        throw new Error('资产报告与本次 tag 或构建提交不一致');
    if (JSON.stringify(manifest.assets.map((asset) => asset.name)) !== JSON.stringify(releaseFiles))
        throw new Error('资产清单不完整或包含非预期文件');
    const expected = [...releaseFiles, 'SHA256SUMS', 'release-manifest.json', 'release-notes.md'];
    if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(expected.sort()))
        throw new Error('发布目录存在遗漏或多余文件');
    let checksums = '';
    for (const asset of manifest.assets) {
        const data = await readFile(path.join(directory, asset.name));
        if (!data.length || data.length !== asset.size || sha256(data) !== asset.sha256)
            throw new Error(`发布资产校验失败：${asset.name}`);
        checksums += `${asset.sha256}  ${asset.name}\n`;
    }
    if ((await readFile(path.join(directory, 'SHA256SUMS'), 'utf8')) !== checksums)
        throw new Error('SHA256SUMS 与构建报告不一致');
    return manifest;
}

async function main() {
    const command = process.argv[2];
    if (command === 'sync-version') {
        const pkg = await json('package.json');
        const desktop = await json('neutralino.config.json');
        validateTag(`v${pkg.version}`, pkg.version, pkg.version);
        desktop.version = pkg.version;
        await writeFile('neutralino.config.json', JSON.stringify(desktop, null, 2) + '\n');
        return;
    }
    const tag = process.argv[3] || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
    const meta = await metadata(tag);
    const output = path.resolve('.desktop-build/publish', tag);
    if (command === 'prepare') {
        await mkdir(output, { recursive: true });
        await writeFile(path.join(output, 'release-notes.md'), releaseNotes(meta));
        if (process.env.GITHUB_OUTPUT)
            await appendFile(
                process.env.GITHUB_OUTPUT,
                `version=${meta.version}\nprerelease=${meta.prerelease}\nmatrix=${JSON.stringify({ include: Object.entries(targets).map(([id, target]) => ({ target: id, runner: target.runner })) })}\n`,
            );
        console.log(`${tag}：版本与更新日志校验通过`);
        return;
    }
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit)
        throw new Error('检出的提交与触发工作流的提交不一致');
    if (command === 'stage') {
        const target = hostTarget();
        const packaged = await json('.desktop-build/package.json');
        if (packaged.target !== target.id) throw new Error('打包结果与 runner 目标不一致');
        const artifact = path.resolve('.desktop-build', `artifact-${target.id}`);
        await mkdir(artifact, { recursive: true });
        const assets = [];
        for (const name of target.assets) {
            const source = packaged.assets.find((file) => path.basename(file) === name);
            if (!source) throw new Error(`缺少打包结果：${name}`);
            const data = await readFile(source);
            await copyFile(source, path.join(artifact, name));
            assets.push({ name, size: data.length, sha256: sha256(data) });
        }
        await writeFile(
            path.join(artifact, `target-report-${target.id}.json`),
            JSON.stringify(
                { target: target.id, tag, version: meta.version, commit, assets },
                null,
                2,
            ) + '\n',
        );
        console.log(`${target.id}：原生 runner 资产报告已生成`);
        return;
    }
    if (command === 'assemble') {
        const assets = [];
        const reports = [];
        const inputs = path.resolve('.desktop-build/artifacts');
        const directories = await readdir(inputs);
        if (
            JSON.stringify(directories.sort()) !==
            JSON.stringify(
                Object.keys(targets)
                    .map((id) => `desktop-${id}`)
                    .sort(),
            )
        )
            throw new Error('构建产物缺少平台或包含多余平台');
        for (const [id, target] of Object.entries(targets)) {
            const directory = path.join(inputs, `desktop-${id}`);
            const report = await json(path.join(directory, `target-report-${id}.json`));
            if (
                report.target !== id ||
                report.tag !== tag ||
                report.version !== meta.version ||
                report.commit !== commit ||
                JSON.stringify(report.assets.map((asset) => asset.name)) !==
                    JSON.stringify(target.assets)
            )
                throw new Error(`目标报告与本次构建不一致：${id}`);
            const names = [...target.assets, `target-report-${id}.json`];
            if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(names.sort()))
                throw new Error('目标目录存在多余文件');
            for (const asset of report.assets) {
                const data = await readFile(path.join(directory, asset.name));
                if (data.length !== asset.size || sha256(data) !== asset.sha256)
                    throw new Error(`传输后的资产校验失败：${asset.name}`);
                await copyFile(path.join(directory, asset.name), path.join(output, asset.name));
                assets.push(asset);
            }
            reports.push(report);
        }
        const manifest = {
            version: meta.version,
            tag,
            commit,
            service: meta.service,
            targets: reports,
            assets,
        };
        await writeFile(
            path.join(output, 'release-manifest.json'),
            JSON.stringify(manifest, null, 2) + '\n',
        );
        await writeFile(
            path.join(output, 'SHA256SUMS'),
            assets.map((asset) => `${asset.sha256}  ${asset.name}\n`).join(''),
        );
    } else if (command !== 'verify') throw new Error('未知发布命令');
    await verifyAssets(output, { tag, commit });
    if ((await readFile(path.join(output, 'release-notes.md'), 'utf8')) !== releaseNotes(meta))
        throw new Error('发布说明与当前更新日志或下载资产不一致');
    console.log(`${tag}：资产、SHA256 和发布说明校验通过`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
    await main();
