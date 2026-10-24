import { init, app, events, os, filesystem as fs } from '@neutralinojs/lib';
import { serviceConfig } from './service-config.js';
import { resolveServiceBinary } from './service-binary.js';

export const native = typeof window !== 'undefined' && 'NL_OS' in window;
const quote = (value) => {
    if (/["\r\n%`$]/.test(value)) throw new Error('应用路径包含不支持的字符');
    return `"${value}"`;
};
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
    const dataDir = await fs.getJoinedPath(directory, 'service');
    const configPath = await fs.getJoinedPath(directory, 'service.json');
    const tokenPath = await fs.getJoinedPath(dataDir, 'secrets', 'bootstrap-token.txt');
    try {
        await fs.getStats(directory);
    } catch {
        await fs.createDirectory(directory);
    }
    let downloads = await fs.getJoinedPath(await os.getPath('music'), '拾音');
    let previous = {};
    try {
        previous = JSON.parse(await fs.readFile(configPath));
        downloads = previous.destinations[0].root;
    } catch {
        /* First launch. */
    }
    try {
        await fs.getStats(downloads);
    } catch {
        await fs.createDirectory(downloads);
    }
    const defaults = serviceConfig(dataDir, downloads, location.origin);
    const config = { ...defaults, ...previous, data_dir: dataDir, cors: defaults.cors };
    config.features = { ...previous.features, ...defaults.features };
    for (const listener of ['control', 'media', 'events'])
        config[listener] = { ...previous[listener], ...defaults[listener] };
    await fs.writeFile(configPath, JSON.stringify(config));
    const binary = await resolveServiceBinary(directory);
    const command = `${quote(binary)} --config ${quote(configPath)}`;
    try {
        await fs.getStats(tokenPath);
    } catch {
        const result = await os.execCommand(`${command} init`);
        if (result.exitCode !== 0) throw new Error('本机服务初始化失败，请检查应用数据目录权限');
    }
    const token = (await fs.readFile(tokenPath)).split(/\r?\n/)[0].trim();
    const sessionPath = await fs.getJoinedPath(directory, 'launcher-session.json');
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
    return new Promise((resolve, reject) => {
        let buffer = '',
            child,
            stopped = false;
        const pending = [];
        const timer = setTimeout(() => {
            stopped = true;
            reject(new Error('本机服务启动超时，请关闭后重试'));
        }, 30000);
        const receive = (event) => {
            const detail = event.detail;
            if (!child) {
                if (pending.length < 32) pending.push(event);
                return;
            }
            if (detail.id !== child.id || stopped) return;
            if (detail.action === 'exit') {
                clearTimeout(timer);
                stopped = true;
                reject(new Error('本机服务退出，请检查是否已打开另一个拾音窗口'));
            }
            if (detail.action !== 'stdOut') return;
            buffer += detail.data;
            if (buffer.length > 65536) {
                clearTimeout(timer);
                stopped = true;
                reject(new Error('服务启动响应异常'));
                return;
            }
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 1);
                try {
                    const report = JSON.parse(line);
                    if (report.event === 'ready') {
                        clearTimeout(timer);
                        void fs
                            .writeFile(
                                sessionPath,
                                JSON.stringify({ ...report, parent_pid: Number(window.NL_PID) }),
                            )
                            .catch(() => {});
                        resolve({ ...report, token, downloads });
                    }
                } catch {
                    /* Ignore non-report output. */
                }
            }
        };
        events
            .on('spawnedProcess', receive)
            .then(async () => {
                child = await os.spawnProcess(
                    `${command} --parent-pid ${Number(window.NL_PID)} serve`,
                );
                for (const event of pending) receive(event);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}
export async function openDownloads(directory) {
    if (!native) throw new Error('请在桌面端打开下载目录');
    await os.open(directory);
}
