import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SERVICE_VERSION } from '../src/service-version.js';

export const releaseFiles = ['qudai-win_x64.exe', 'qudai-windows-x64.zip'];
const output = path.resolve('.desktop-build/publish');
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

export function releaseNotes({ tag, repository, changes }) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('无效的 GitHub 仓库');
    const base = `https://github.com/${repository}`;
    const download = `${base}/releases/download/${tag}`;
    return `## 更新内容\n\n${changes}\n\n## 运行要求\n\nWindows x64，需要 WebView2 运行时。EXE 可直接运行，ZIP 解压后包含同一个 EXE。首次运行会释放本机服务并创建配置与数据，音源可用性及账号授权以实际结果为准。\n\n旧开发版本的服务数据库不自动迁移，升级前请阅读[数据与兼容性说明](${base}/blob/${tag}/docs/development.md#开发和运行)。\n\n[完整更新日志](${base}/blob/${tag}/CHANGELOG.md) · [SHA256 校验文件](${download}/SHA256SUMS) · [构建与资产报告](${download}/release-manifest.json)\n\n## 下载\n\n| 系统 | 下载 |\n| --- | --- |\n| Windows | [![EXE x64](https://img.shields.io/badge/EXE-x64-2d7d9a?style=flat-square)](${download}/qudai-win_x64.exe)<br>[![ZIP x64](https://img.shields.io/badge/ZIP-x64-67b7d1?style=flat-square)](${download}/qudai-windows-x64.zip) |\n`;
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
    return { tag, version: pkg.version, repository, service, changes };
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
    if (command === 'prepare') {
        await mkdir(output, { recursive: true });
        await writeFile(path.join(output, 'release-notes.md'), releaseNotes(meta));
        if (process.env.GITHUB_OUTPUT)
            await appendFile(
                process.env.GITHUB_OUTPUT,
                `version=${meta.version}\nbackend_repository=${meta.service.repository}\nbackend_revision=${meta.service.revision}\n`,
            );
        console.log(`${tag}：版本与更新日志校验通过`);
        return;
    }
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit)
        throw new Error('检出的提交与触发工作流的提交不一致');
    if (command === 'stage') {
        const assets = [];
        for (const name of releaseFiles) {
            const source = name.endsWith('.exe')
                ? path.join('release/qudai-windows-x64', name)
                : path.join('release', name);
            const data = await readFile(source);
            await copyFile(source, path.join(output, name));
            assets.push({ name, size: data.length, sha256: sha256(data) });
        }
        const manifest = {
            version: meta.version,
            tag,
            commit,
            service: meta.service,
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
