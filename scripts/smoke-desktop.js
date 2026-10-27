import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Api } from '../src/api.js';

if (process.env.CI !== 'true')
    throw new Error('桌面启动检查仅允许在隔离的 CI 账号中运行，避免读取本机用户数据');
const pkg = JSON.parse(await readFile('.desktop-build/smoke-package.json', 'utf8'));
const dataHome =
    process.platform === 'win32'
        ? process.env.APPDATA
        : process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library/Application Support')
          : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
const directory = path.join(dataHome, 'shiyin/service');
const sessionFile = path.join(directory, 'launcher-session.json');
assert(!(await stat(sessionFile).catch(() => null)), 'CI 账号必须没有既有曲袋服务数据');
async function ownedPid(pid, parent) {
    if (pid === parent) return true;
    if (process.platform !== 'linux') return false;
    for (let i = 0; i < 16 && pid > 1; i++) {
        const status = await readFile(`/proc/${pid}/status`, 'utf8');
        pid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);
        if (pid === parent) return true;
    }
    return false;
}
for (const installation of pkg.installations) {
    const desktop = spawn(
        installation.executable,
        ['--window-hidden=true', '--data-location=system'],
        {
            windowsHide: true,
            stdio: 'inherit',
            env: { ...process.env, ...installation.env },
        },
    );
    const exited = once(desktop, 'exit');
    let session;
    try {
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            if (desktop.exitCode !== null) throw new Error(`桌面程序提前退出：${desktop.exitCode}`);
            try {
                const ready = JSON.parse(await readFile(sessionFile, 'utf8'));
                if (await ownedPid(ready.parent_pid, desktop.pid)) {
                    session = ready;
                    break;
                }
            } catch {
                /* 等待真实前端完成服务启动。 */
            }
            await delay(200);
        }
        assert(session, '真实桌面前端未在 60 秒内启动服务');
        const token = (await readFile(path.join(directory, 'secrets/bootstrap-token.txt'), 'utf8'))
            .split(/\r?\n/)[0]
            .trim();
        const providers = (
            await new Api({ ...session, token }).request('/providers', { query: { limit: 100 } })
        ).data.items;
        assert.equal(providers.length, 9);
        console.log(
            `${pkg.target} ${installation.format}：最终发行包的桌面 WebView、前端 JavaScript、真实服务启动与鉴权通过`,
        );
    } finally {
        // AppImage 外层运行时会派生 AppRun；只结束真实桌面父进程，保留后端自行监测停机。
        if (session && session.parent_pid !== desktop.pid)
            process.kill(session.parent_pid, 'SIGTERM');
        else desktop.kill();
        await Promise.race([
            exited,
            delay(5000).then(() => {
                throw new Error('桌面进程未能退出');
            }),
        ]);
    }
    if (session) {
        let stopped = false;
        for (let i = 0; i < 60; i++) {
            try {
                await fetch(`${session.api_base_url}/api/v1/info`, {
                    signal: AbortSignal.timeout(500),
                });
            } catch {
                stopped = true;
                break;
            }
            await delay(250);
        }
        assert(stopped, '桌面退出后服务没有按父进程生命周期停机');
        console.log('桌面退出后的真实服务停机检查通过');
    }
    await unlink(sessionFile);
}
