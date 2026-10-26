import { terminal } from './api.js';
export function canTaskAction(task, action) {
    if (action === 'hide') return terminal(task);
    if (action === 'retry') return ['failed', 'canceled'].includes(task.status);
    if (action === 'cancel')
        return [
            'queued',
            'resolving',
            'probing',
            'downloading',
            'processing',
            'waiting_retry',
        ].includes(task.status);
    return false;
}
// Fetch-based SSE keeps the bearer out of URLs. Events trigger authoritative
// snapshots; reconnect also synchronizes missed terminal events.
export function applyTaskProjection(task, event) {
    if (
        !task ||
        event.task_id !== task.task_id ||
        !Number.isFinite(event.version) ||
        event.version <= task.version
    )
        return task;
    return {
        ...task,
        version: event.version,
        status: event.status,
        progress: event.progress,
        updated_at: event.updated_at,
    };
}
export function watchTasks(api, synchronize, report, receive = () => {}) {
    const controller = new AbortController();
    let timer,
        pending = false,
        dirty = false;
    const sync = async () => {
        if (pending) {
            dirty = true;
            return;
        }
        pending = true;
        try {
            if (await synchronize()) dirty = true;
            report('');
        } catch {
            report('任务状态同步失败，正在重连');
        } finally {
            pending = false;
            if (dirty && !controller.signal.aborted) {
                dirty = false;
                clearTimeout(timer);
                timer = setTimeout(() => {
                    timer = null;
                    void sync();
                }, 500);
            }
        }
    };
    const schedule = () => {
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            void sync();
        }, 250);
    };
    const run = async () => {
        while (!controller.signal.aborted) {
            try {
                if (!api.session.events_base_url) {
                    receive({ poll: true });
                    await sync();
                    await pause(1500, controller.signal);
                    continue;
                }
                const response = await fetch(
                    `${api.session.events_base_url.replace(/\/$/, '')}/events/v1/downloads`,
                    {
                        headers: { Authorization: `Bearer ${api.session.token}` },
                        signal: controller.signal,
                        cache: 'no-store',
                    },
                );
                if (!response.ok || !response.body) throw new Error('无法订阅任务');
                receive(null);
                await sync();
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                try {
                    while (!controller.signal.aborted) {
                        const { done, value } = await reader.read();
                        if (done) throw new Error('任务事件流已关闭');
                        buffer += decoder.decode(value, { stream: true });
                        buffer = buffer.replace(/\r\n/g, '\n');
                        if (buffer.length > 262144) throw new Error('事件过大');
                        let end;
                        while ((end = buffer.indexOf('\n\n')) >= 0) {
                            const event = buffer.slice(0, end);
                            buffer = buffer.slice(end + 2);
                            if (/event: ?task.updated/.test(event)) {
                                const data = event
                                    .split('\n')
                                    .filter((line) => line.startsWith('data:'))
                                    .map((line) => line.slice(5).trim())
                                    .join('\n');
                                try {
                                    receive(JSON.parse(data));
                                } catch {
                                    /* Reconnect snapshots remain authoritative. */
                                }
                            }
                            if (/event: ?(task.updated|stream.ready)/.test(event)) schedule();
                        }
                    }
                } finally {
                    await reader.cancel().catch(() => {});
                }
            } catch {
                if (!controller.signal.aborted) {
                    report('实时连接中断，正在重连');
                    receive({ poll: true });
                    await sync();
                }
            }
            if (!controller.signal.aborted) await pause(2500, controller.signal);
        }
    };
    void run();
    const stop = () => {
        controller.abort();
        clearTimeout(timer);
    };
    stop.refresh = schedule;
    return stop;
}
function pause(ms, signal) {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
        const end = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', end);
            resolve();
        };
        const timer = setTimeout(end, ms);
        signal.addEventListener('abort', end, { once: true });
    });
}
