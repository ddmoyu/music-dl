import { spawn, fork } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { serviceConfig } from '../src/service-config.js';

export async function startService({ binary, directory, origin }) {
    const configPath = path.join(directory, 'service.json');
    const data = path.join(directory, 'data');
    const downloads = path.join(directory, 'downloads');
    await mkdir(downloads, { recursive: true });
    await writeFile(configPath, JSON.stringify(serviceConfig(data, downloads, origin)), {
        mode: 0o600,
    });
    const tokenFile = path.join(data, 'secrets', 'bootstrap-token.txt');
    try {
        await access(tokenFile);
    } catch {
        await new Promise((resolve, reject) => {
            const child = spawn(binary, ['--config', configPath, 'init'], {
                windowsHide: true,
                stdio: 'ignore',
            });
            child.once('error', reject);
            child.once('exit', (code) =>
                code === 0 ? resolve() : reject(new Error(`服务初始化失败 (${code})`)),
            );
        });
    }
    const token = (await readFile(tokenFile, 'utf8')).split(/\r?\n/)[0].trim();
    const child = spawn(
        binary,
        ['--config', configPath, '--parent-pid', String(process.pid), 'serve'],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const ready = await new Promise((resolve, reject) => {
        let buffer = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('本机服务启动超时'));
        }, 30000);
        child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`本机服务已退出 (${code})`));
        });
        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            if (buffer.length > 65536) {
                clearTimeout(timer);
                child.kill();
                reject(new Error('服务启动响应异常'));
                return;
            }
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 1);
                try {
                    const result = JSON.parse(line);
                    if (result.event === 'ready') {
                        clearTimeout(timer);
                        resolve(result);
                    }
                } catch {
                    /* Other stdout is not a launch report. */
                }
            }
        });
    });
    return { ...ready, token, downloads, child };
}

export function localServicePlugin() {
    let session, worker;
    return {
        name: 'local-music-service',
        configureServer(server) {
            server.httpServer?.once('close', () => {
                if (worker?.connected) worker.disconnect();
            });
            server.middlewares.use('/__desktop/session', async (req, res) => {
                const origin = `http://${req.headers.host}`;
                if (
                    req.method !== 'GET' ||
                    !/^127\.0\.0\.1:\d+$/.test(req.headers.host || '') ||
                    req.headers.host !== `127.0.0.1:${server.httpServer.address()?.port}` ||
                    req.headers['x-shiyin-client'] !== 'desktop' ||
                    (req.headers.origin && req.headers.origin !== origin)
                ) {
                    res.writeHead(403).end();
                    return;
                }
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Content-Type', 'application/json');
                try {
                    session ??= new Promise((resolve, reject) => {
                        worker = fork(path.resolve('scripts/service-worker.js'), {
                            windowsHide: true,
                            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
                        });
                        worker.once('error', reject);
                        worker.once('exit', () => {
                            session = null;
                            reject(new Error('本机服务已退出'));
                        });
                        worker.once('message', (message) =>
                            message.error
                                ? reject(new Error(message.error))
                                : resolve(message.session),
                        );
                        worker.send({
                            binary:
                                process.env.MUSIC_SERVICE_BINARY ||
                                path.resolve('bin/service/music-service.exe'),
                            directory: path.resolve(
                                `.tmp/development-service-${server.httpServer.address().port}`,
                            ),
                            origin,
                        });
                    }).catch((error) => {
                        session = null;
                        throw error;
                    });
                    const data = await session;
                    res.end(JSON.stringify(data));
                } catch (error) {
                    res.statusCode = 503;
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
        },
    };
}
