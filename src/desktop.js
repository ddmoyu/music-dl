import { init, app, events, os, filesystem as fs } from '@neutralinojs/lib';
import { prepareServiceConfig } from './service-config.js';
import { resolveServiceBinary } from './service-binary.js';
import { SERVICE_DATA_DIRECTORY } from './service-version.js';
import { ensureDirectory, readOptionalFile } from './native-files.js';
import { launchService } from './service-launch.js';
import { commandArgument } from './command-argument.js';

export const native = typeof window !== 'undefined' && 'NL_OS' in window;
const quote = (value) => commandArgument(value, window.NL_OS);
export async function bootService() {
    if (!native) {
        const response = await fetch('/__desktop/session', {
            headers: { 'X-Shiyin-Client': 'desktop' },
            cache: 'no-store',
        });
        const session = await response.json();
        if (!response.ok) throw new Error(session.error || '无法启动本机服务');
        return session;
    }
    init();
    await events.on('windowClose', () => app.exit());
    const directory = await fs.getJoinedPath(await os.getPath('data'), 'shiyin');
    const dataDir = await fs.getJoinedPath(directory, SERVICE_DATA_DIRECTORY);
    const tokenPath = await fs.getJoinedPath(dataDir, 'secrets', 'bootstrap-token.txt');
    await ensureDirectory(fs, directory);
    const { configPath, downloads } = await prepareServiceConfig(
        fs,
        directory,
        dataDir,
        await fs.getJoinedPath(await os.getPath('music'), '曲袋'),
        location.origin,
    );
    await ensureDirectory(fs, downloads);
    const binary = await resolveServiceBinary(directory);
    const command = `${quote(binary)} --config ${quote(configPath)}`;
    const secrets = await fs.getJoinedPath(dataDir, 'secrets');
    const hasData = (await fs.readDirectory(directory)).some(
        (entry) => entry.entry === SERVICE_DATA_DIRECTORY,
    );
    const hasSecrets =
        hasData && (await fs.readDirectory(dataDir)).some((entry) => entry.entry === 'secrets');
    if (!hasSecrets || (await readOptionalFile(fs, secrets, 'bootstrap-token.txt')) === null) {
        const result = await os.execCommand(`${command} init`);
        if (result.exitCode !== 0) throw new Error('本机服务初始化失败，请检查应用数据目录权限');
    }
    const token = (await fs.readFile(tokenPath)).split(/\r?\n/)[0].trim();
    const sessionPath = await fs.getJoinedPath(dataDir, 'launcher-session.json');
    try {
        const saved = JSON.parse(await fs.readFile(sessionPath));
        const url = new URL(saved.api_base_url);
        if (
            saved.parent_pid === Number(window.NL_PID) &&
            url.protocol === 'http:' &&
            url.hostname === '127.0.0.1' &&
            !url.username &&
            !url.password
        ) {
            const response = await fetch(`${url.origin}/api/v1/info`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(2000),
            });
            const info = await response.json();
            if (response.ok && info.data.instance_id === saved.instance_id)
                return {
                    ...saved,
                    api_base_url: url.origin,
                    media_base_url: info.data.media_base_url,
                    events_base_url: info.data.events_base_url,
                    token,
                    downloads,
                };
        }
    } catch {
        /* A fresh launcher or a stopped service needs a new process. */
    }
    const report = await launchService(`${command} --parent-pid ${Number(window.NL_PID)} serve`);
    await fs
        .writeFile(sessionPath, JSON.stringify({ ...report, parent_pid: Number(window.NL_PID) }))
        .catch(() => {});
    return { ...report, token, downloads };
}
export async function openDownloads(directory) {
    if (!native) throw new Error('请在桌面端打开下载目录');
    await os.open(directory);
}
