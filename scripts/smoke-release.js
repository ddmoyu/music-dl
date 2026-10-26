import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';
import { startService } from './local-service.js';
import { Api } from '../src/api.js';
import { SERVICE_VERSION } from '../src/service-version.js';

const require = createRequire(createRequire(import.meta.url).resolve('@neutralinojs/neu'));
const pe = require('pe-library');
const asar = require('@electron/asar');
const directory = path.resolve('.desktop-build', `release-smoke-${crypto.randomUUID()}`);
await mkdir(directory, { recursive: true });
const exe = pe.NtExecutable.from(await readFile('release/qudai-windows-x64/qudai-win_x64.exe'));
const embedded = pe.NtExecutableResource.from(exe).entries.find(
    (entry) => entry.type === 10 && entry.id === 'NEUTRALINOJS_RESOURCES_NEU',
);
assert(embedded, '发行 EXE 必须内嵌 resources.neu');
const archive = path.join(directory, 'resources.neu');
await writeFile(archive, Buffer.from(embedded.bin));
const files = asar.listPackage(archive).map((file) => file.replaceAll('\\', '/'));
assert(files.includes('/dist/app/index.html'));
assert(files.includes('/dist/app/licenses/music-service/taglib-COPYING.MPL.txt'));
assert(files.includes('/dist/app/licenses/neutralino-runtime.txt'));
assert(files.every((file) => !/(?:^|\/)(?:prototype|\.storage|\.tmp)(?:\/|$)/.test(file)));
assert(files.every((file) => file === '/neutralino.config.json' || /^\/dist(?:\/|$)/.test(file)));
const embeddedConfig = JSON.parse(asar.extractFile(archive, 'neutralino.config.json'));
assert.equal(embeddedConfig.version, JSON.parse(await readFile('package.json', 'utf8')).version);
const binaryData = asar.extractFile(
    archive,
    path.join('dist', 'app', 'service', 'music-service.exe'),
);
assert.equal(binaryData.length, embeddedConfig.globalVariables.SHIYIN_SERVICE.size);
assert.equal(
    crypto.createHash('sha256').update(binaryData).digest('hex'),
    embeddedConfig.globalVariables.SHIYIN_SERVICE.sha256,
);
assert.deepEqual(binaryData, await readFile(process.env.MUSIC_SERVICE_BINARY));
const binary = path.join(directory, 'music-service.exe');
await writeFile(binary, binaryData);
assert.equal(
    execFileSync(binary, ['version'], { encoding: 'utf8', windowsHide: true }).trim(),
    `music-service ${SERVICE_VERSION}`,
);
const expected = JSON.parse(await readFile('scripts/release-service.json', 'utf8')).providers;
const session = await startService({
    binary,
    directory: path.join(directory, 'data'),
    origin: 'http://127.0.0.1:5175',
});
try {
    const api = new Api(session);
    const providers = (await api.request('/providers', { query: { limit: 100 } })).data.items;
    assert.deepEqual(providers.map((provider) => provider.source).sort(), expected.sort());
    assert((await api.request('/destinations')).data.items.length > 0);
    assert.equal((await api.request('/downloads', { query: { limit: 100 } })).data.items.length, 0);
    const anonymous = await fetch(`${session.api_base_url}/api/v1/providers`);
    assert.equal(anonymous.status, 401);
    console.log('EXE 内嵌页面、许可及后端校验通过；真实服务、全部平台、下载目标与鉴权通过');
} finally {
    const exited = once(session.child, 'exit');
    session.child.kill();
    await exited;
}
