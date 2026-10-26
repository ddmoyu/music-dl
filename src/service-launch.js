import { events, os } from '@neutralinojs/lib';

// 仅管理本次启动的进程；成功后由后端的父进程监测接管生命周期。
export async function launchService(command, timeout = 30000) {
    let child,
        settled = false,
        exited = false,
        buffer = '';
    const pending = [];
    let resolve, reject, confirmExit;
    const ready = new Promise((done, fail) => {
        resolve = done;
        reject = fail;
    });
    const cleanup = () => {
        clearTimeout(timer);
        void events.off('spawnedProcess', receive);
    };
    const terminate = async () => {
        if (!child || exited) return;
        let exitTimer;
        const exit = new Promise((done) => {
            confirmExit = done;
            exitTimer = setTimeout(() => done(false), 3000);
        });
        try {
            await os.updateSpawnedProcess(child.id, 'exit');
            if (!exited && !(await exit)) throw new Error('启动进程未确认退出');
        } catch (error) {
            if (!exited) throw error;
        } finally {
            clearTimeout(exitTimer);
        }
    };
    const fail = async (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
            await terminate();
            reject(error);
        } catch (cause) {
            reject(new Error(`${error.message}；未能清理启动进程，请关闭窗口后重试`, { cause }));
        } finally {
            cleanup();
        }
    };
    const receive = (event) => {
        const detail = event.detail;
        if (!child) {
            if (pending.length < 32) pending.push(event);
            return;
        }
        if (detail.id !== child.id) return;
        if (detail.action === 'exit') {
            exited = true;
            confirmExit?.(true);
            void fail(new Error('本机服务退出，请检查是否已打开另一个曲袋窗口'));
            return;
        }
        if (settled || detail.action !== 'stdOut') return;
        buffer += detail.data;
        if (buffer.length > 65536) {
            void fail(new Error('服务启动响应异常'));
            return;
        }
        let end;
        while (!settled && (end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            let report;
            try {
                report = JSON.parse(line);
            } catch {
                continue;
            }
            if (report.event === 'ready') {
                settled = true;
                cleanup();
                resolve(report);
            }
        }
    };
    const timer = setTimeout(() => void fail(new Error('本机服务启动超时，请重新连接')), timeout);
    void (async () => {
        try {
            await events.on('spawnedProcess', receive);
            if (settled) {
                cleanup();
                return;
            }
            child = await os.spawnProcess(command);
            if (settled) {
                // 原生调用可能在超时后才返回，仍需回收它创建的进程。
                await events.on('spawnedProcess', receive);
                try {
                    await terminate();
                } finally {
                    cleanup();
                }
                return;
            }
            for (const event of pending) receive(event);
            pending.length = 0;
        } catch (error) {
            if (!settled) await fail(error);
            else console.error('本机服务启动清理失败', error.code || error.message);
        }
    })();
    return ready;
}
