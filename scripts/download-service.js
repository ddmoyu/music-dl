import { mkdir, readFile, readdir, cp, appendFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { hostTarget } from './desktop-targets.js';
import { SERVICE_VERSION } from '../src/service-version.js';

const target = hostTarget();
const service = JSON.parse(await readFile('scripts/release-service.json', 'utf8'));
if (service.version !== SERVICE_VERSION || service.tag !== `v${SERVICE_VERSION}`)
    throw new Error('锁定的后端 Release 版本不一致');
const stage = path.resolve('.desktop-build', `backend-download-${randomUUID()}`);
await mkdir(stage, { recursive: true });
const asset = `music-service-${service.version}-${target.backend}`;
execFileSync(
    'gh',
    [
        'release',
        'download',
        service.tag,
        '--repo',
        service.repository,
        '--pattern',
        asset,
        '--pattern',
        'release-manifest.json',
        '--dir',
        stage,
    ],
    { stdio: 'inherit', windowsHide: true, timeout: 300000 },
);
const digest = (data) => createHash('sha256').update(data).digest('hex');
const reportData = await readFile(path.join(stage, 'release-manifest.json'));
if (digest(reportData) !== service.manifestSha256) throw new Error('后端发布报告 SHA256 不匹配');
const report = JSON.parse(reportData);
const record = report.files.find((item) => item.name === asset);
const payload = await readFile(path.join(stage, asset));
if (
    report.commit !== service.revision ||
    report.version !== service.version ||
    !record ||
    payload.length !== record.size_bytes ||
    digest(payload) !== record.sha256 ||
    record.sha256 !== service.assets[target.id]
)
    throw new Error('后端包与锁定的提交、版本或校验和不一致');
const extracted = path.join(stage, 'extracted');
await mkdir(extracted);
const entries = execFileSync('tar', ['-tf', path.join(stage, asset)], {
    encoding: 'utf8',
    windowsHide: true,
})
    .trim()
    .split(/\r?\n/);
if (
    entries.some(
        (entry) =>
            entry.startsWith('/') ||
            entry.includes('\\') ||
            entry.split('/').includes('..') ||
            /^[a-z]:/i.test(entry),
    )
)
    throw new Error('后端归档包含不安全路径');
execFileSync('tar', ['-xf', path.join(stage, asset), '-C', extracted], { windowsHide: true });
const roots = await readdir(extracted);
if (roots.length !== 1) throw new Error('后端包必须只有一个根目录');
const source = path.join(extracted, roots[0]);
const bundle = path.resolve('bin/service', SERVICE_VERSION, 'bundle');
await mkdir(path.dirname(bundle), { recursive: true });
await cp(source, bundle, { recursive: true });
const binary = path.join(
    bundle,
    'bin',
    target.platform === 'win32' ? 'music-service.exe' : 'music-service',
);
const actualVersion = execFileSync(binary, ['version'], {
    encoding: 'utf8',
    windowsHide: true,
}).trim();
if (actualVersion !== `music-service ${SERVICE_VERSION}`)
    throw new Error('下载的后端无法在当前目标运行');
if (process.env.GITHUB_ENV)
    await appendFile(
        process.env.GITHUB_ENV,
        `MUSIC_SERVICE_BINARY=${binary}\nMUSIC_SERVICE_BUNDLE=${bundle}\nMUSIC_SERVICE_LICENSES=${path.join(bundle, 'share/music-service/licenses')}\n`,
    );
console.log(`${target.id}：后端 Release 校验并运行通过（${service.revision}）`);
