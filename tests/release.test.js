import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    changelogEntry,
    releaseFiles,
    releaseNotes,
    validateTag,
    verifyAssets,
} from '../scripts/release.js';

let directory;
afterEach(async () => {
    if (directory) {
        if (
            path.dirname(directory) !== os.tmpdir() ||
            !path.basename(directory).startsWith('qudai-release-test-')
        )
            throw new Error('不安全的测试清理目录');
        await rm(directory, { recursive: true, force: true });
        directory = null;
    }
});

it('refuses invalid tags and mismatched desktop metadata before publishing', () => {
    for (const tag of ['v01.2.3', '0.1.2', 'v0.1.2-beta', 'v0.1.2/extra', 'v0.1.3'])
        expect(() => validateTag(tag, '0.1.2', '0.1.2')).toThrow();
    expect(() => validateTag('v0.1.2', '0.1.2', '0.1.1')).toThrow();
    expect(() => validateTag('v0.1.2', '0.1.2', '0.1.2')).not.toThrow();
});

it('publishes only the requested dated changelog entry, not Unreleased or older entries', () => {
    const log =
        '# 日志\r\n\r\n## Unreleased\r\n\r\n- 未来改动\r\n\r\n## 0.1.2 - 2026-10-26\r\n\r\n### 新增\r\n\r\n- 本次改动\r\n\r\n## 0.1.1\r\n\r\n- 旧改动\r\n';
    expect(changelogEntry(log, '0.1.2')).toBe('### 新增\n\n- 本次改动');
    expect(() => changelogEntry(log, '0.1.3')).toThrow();
    expect(() => changelogEntry('## 0.1.2 - 2026-10-26\n\n', '0.1.2')).toThrow();
});

it('ends release notes with tag-specific downloads for the complete platform set', () => {
    const notes = releaseNotes({
        tag: 'v0.1.2',
        repository: 'ddmoyu/music-dl',
        changes: '- 新增下载',
    });
    expect(notes).toContain('/releases/download/v0.1.2/qudai-win_x64.exe');
    expect(notes).toContain('/releases/download/v0.1.2/qudai-windows-x64.zip');
    expect(notes).not.toContain('latest/download');
    for (const name of releaseFiles) expect(notes).toContain(`/releases/download/v0.1.2/${name}`);
    expect(notes).toContain('ARM64');
    expect(notes).toContain(
        'https://img.shields.io/badge/APP-Apple%20Silicon-2d7d9a?style=flat-square',
    );
    expect(notes).not.toContain('/badge/APP-Apple-Silicon-');
    expect(notes.trim().split('\n').at(-1)).toMatch(/^\| macOS \|.*\|$/);
});

async function fixture() {
    directory = await mkdtemp(path.join(os.tmpdir(), 'qudai-release-test-'));
    const assets = [];
    for (const name of releaseFiles) {
        const data = Buffer.from(`release payload ${name}`);
        await writeFile(path.join(directory, name), data);
        assets.push({
            name,
            size: data.length,
            sha256: createHash('sha256').update(data).digest('hex'),
        });
    }
    const manifest = { tag: 'v0.1.2', version: '0.1.2', commit: 'a'.repeat(40), assets };
    await writeFile(path.join(directory, 'release-manifest.json'), JSON.stringify(manifest));
    await writeFile(
        path.join(directory, 'SHA256SUMS'),
        assets.map((a) => `${a.sha256}  ${a.name}\n`).join(''),
    );
    await writeFile(path.join(directory, 'release-notes.md'), 'release notes');
    return manifest;
}

it('detects a changed asset after transferring the build artifact', async () => {
    const manifest = await fixture();
    await expect(verifyAssets(directory, manifest)).resolves.toMatchObject(manifest);
    await writeFile(path.join(directory, releaseFiles[0]), 'modified payload');
    await expect(verifyAssets(directory, manifest)).rejects.toThrow('校验失败');
});

it('rejects assets from another tag or commit', async () => {
    const manifest = await fixture();
    await expect(verifyAssets(directory, { ...manifest, commit: 'b'.repeat(40) })).rejects.toThrow(
        '不一致',
    );
    await expect(verifyAssets(directory, { ...manifest, tag: 'v0.1.3' })).rejects.toThrow('不一致');
});

it('refuses unexpected files and checksum report drift', async () => {
    const manifest = await fixture();
    await writeFile(path.join(directory, 'SHA256SUMS'), 'wrong checksums');
    await expect(verifyAssets(directory, manifest)).rejects.toThrow('SHA256SUMS');
    await writeFile(path.join(directory, 'user-data.json'), '{}');
    await expect(verifyAssets(directory, manifest)).rejects.toThrow('多余文件');
});

it('rejects a manipulated manifest file list before reading arbitrary paths', async () => {
    const manifest = await fixture();
    manifest.assets[0].name = '../outside.exe';
    await writeFile(path.join(directory, 'release-manifest.json'), JSON.stringify(manifest));
    await expect(verifyAssets(directory, manifest)).rejects.toThrow('非预期文件');
});
