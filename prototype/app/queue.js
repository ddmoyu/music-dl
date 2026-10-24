import { providerById, destinations, canSelectTrack } from './providers.js';

export const defaults = {
    quality: 'best',
    destination: 'music',
    skipDuplicates: true,
    allowLower: true,
    allowPreview: false,
    metadataPolicy: 'best_effort',
    serviceUrl: 'http://127.0.0.1:17632',
};
export const MAX_ACTIVE = 500;
export const MAX_TASKS = 2000;
export const WORKERS = 3;
export const statuses = {
    queued: '等待中',
    resolving: '解析音源',
    probing: '检查音源',
    downloading: '下载中',
    processing: '处理文件',
    finalizing: '保存文件',
    waiting_retry: '等待重试',
    canceling: '取消中',
    completed: '已完成',
    failed: '失败',
    canceled: '已取消',
};
export const isPending = (task) => !['completed', 'failed', 'canceled'].includes(task.status);
const isRunning = (task) =>
    ['resolving', 'probing', 'downloading', 'processing', 'finalizing'].includes(task.status);
const ranks = ['standard', 'high', 'lossless', 'hires'];
export const qualityLabel = (q) =>
    ({ standard: '标准', high: '高品质', lossless: '无损', hires: 'Hi-Res' })[q] ?? q;

function qualityFor(track, settings) {
    const supported = providerById.get(track.source)?.qualities ?? ranks;
    const maximum =
        { 'Hi-Res': 'hires', SQ: 'lossless', HQ: 'high', MP3: 'standard', AAC: 'standard' }[
            track.quality
        ] ?? 'standard';
    const actualMax =
        supported.filter((q) => ranks.indexOf(q) <= ranks.indexOf(maximum)).at(-1) ?? 'standard';
    const requested = settings.quality === 'best' ? supported.at(-1) : settings.quality;
    const actual = ranks.indexOf(requested) <= ranks.indexOf(actualMax) ? requested : actualMax;
    return {
        requested,
        actual,
        lowered: actual !== requested,
        totalMB: { standard: 4.6, high: 10.8, lossless: 32.8, hires: 86.4 }[actual],
    };
}
function fingerprint(track, settings) {
    return JSON.stringify([
        track.id,
        settings.quality,
        settings.destination,
        settings.allowLower,
        settings.allowPreview,
        settings.metadataPolicy,
    ]);
}
function newTask(track, settings, batchId) {
    const q = qualityFor(track, settings);
    return {
        id: crypto.randomUUID(),
        track,
        batchId,
        status: 'queued',
        progress: 0,
        speed: 0,
        quality: q.actual,
        requestedQuality: q.requested,
        totalMB: q.totalMB,
        options: { ...settings },
        intent: fingerprint(track, settings),
        warnings: [],
        createdAt: new Date().toISOString(),
    };
}
export function addToQueue(queue, songs, settings, batchId = crypto.randomUUID()) {
    const next = [...queue];
    const activeKeys = new Set(
        queue.filter(isPending).map((t) => t.intent ?? fingerprint(t.track, t.options)),
    );
    const completeKeys = new Set(
        queue
            .filter((t) => t.status === 'completed')
            .map((t) => t.intent ?? fingerprint(t.track, t.options)),
    );
    let added = 0,
        skipped = 0,
        unavailable = 0,
        capacity = 0;
    let active = queue.filter(isPending).length;
    for (const track of songs) {
        if (!canSelectTrack(track, settings)) {
            unavailable++;
            continue;
        }
        const key = fingerprint(track, settings);
        if (activeKeys.has(key) || (settings.skipDuplicates && completeKeys.has(key))) {
            skipped++;
            continue;
        }
        if (active >= MAX_ACTIVE || next.length >= MAX_TASKS) {
            capacity++;
            continue;
        }
        next.push(newTask(track, settings, batchId));
        activeKeys.add(key);
        active++;
        added++;
    }
    return { tasks: next, added, skipped, unavailable, capacity };
}

/** Simulated transport only. No audio or sidecar is written. Pausing admission
 * does not pause work already running, matching the service scheduling policy. */
export function advanceQueue(queue, concurrency = WORKERS, seconds = 0.6, paused = false) {
    let slots = Math.max(0, concurrency - queue.filter(isRunning).length);
    return queue.map((task) => {
        if (task.status === 'canceling') return { ...task, status: 'canceled', speed: 0 };
        if (task.status === 'queued') {
            if (paused || slots <= 0) return task;
            slots--;
            return { ...task, status: 'resolving' };
        }
        if (task.status === 'resolving') {
            const q = qualityFor(task.track, task.options);
            if (q.lowered && !task.options.allowLower && task.options.quality !== 'best')
                return {
                    ...task,
                    status: 'failed',
                    error: '当前来源没有所选音质。可选择较低音质后重新下载。',
                    errorCode: 'QUALITY_UNAVAILABLE',
                    speed: 0,
                };
            return {
                ...task,
                status: 'probing',
                warnings: [
                    ...(q.lowered ? ['已使用较低音质'] : []),
                    ...(task.track.access === 'preview' ? ['保存的是试听片段'] : []),
                ],
            };
        }
        if (task.status === 'probing') return { ...task, status: 'downloading' };
        if (task.status === 'processing') return { ...task, status: 'finalizing' };
        if (task.status === 'finalizing')
            return {
                ...task,
                status: 'completed',
                progress: 100,
                speed: 0,
                finishedAt: new Date().toISOString(),
            };
        if (task.status !== 'downloading') return task;
        const speed = 1.8 + (task.track.title.length % 4) * 0.3;
        const progress = Math.min(
            100,
            task.progress + ((speed * Math.max(0, seconds)) / task.totalMB) * 100,
        );
        return {
            ...task,
            progress,
            speed: progress === 100 ? 0 : speed,
            status: progress === 100 ? 'processing' : 'downloading',
        };
    });
}
export function changeTask(queue, id, action, settings) {
    const task = queue.find((t) => t.id === id);
    if (!task) return queue;
    if (action === 'retry' && ['failed', 'canceled'].includes(task.status)) {
        const result = addToQueue(queue, [task.track], task.options, task.batchId);
        if (result.added) result.tasks.at(-1).retryOf = task.id;
        return result.tasks;
    }
    if (action === 'cancel')
        return queue.map((t) =>
            t.id !== id || !isPending(t) || t.status === 'finalizing'
                ? t
                : {
                      ...t,
                      status: ['queued', 'waiting_retry'].includes(t.status)
                          ? 'canceled'
                          : 'canceling',
                      speed: 0,
                  },
        );
    if (action === 'redownload')
        return addToQueue(queue, [task.track], { ...settings, skipDuplicates: false }).tasks;
    return queue;
}
export function readSettings(value) {
    const result = { ...defaults };
    if (!value || typeof value !== 'object') return result;
    if (['best', ...ranks].includes(value.quality)) result.quality = value.quality;
    if (destinations.some((d) => d.id === value.destination && d.available))
        result.destination = value.destination;
    for (const key of ['skipDuplicates', 'allowLower', 'allowPreview'])
        if (typeof value[key] === 'boolean') result[key] = value[key];
    if (['best_effort', 'required', 'skip'].includes(value.metadataPolicy))
        result.metadataPolicy = value.metadataPolicy;
    if (typeof value.serviceUrl === 'string') {
        try {
            const url = new URL(value.serviceUrl);
            if (
                ['http:', 'https:'].includes(url.protocol) &&
                !url.username &&
                !url.password &&
                !url.search &&
                !url.hash
            )
                result.serviceUrl = url.href.replace(/\/$/, '');
        } catch {
            /* Use default. */
        }
    }
    return result;
}
export function readStored(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
    } catch {
        return fallback;
    }
}
export function restoreTasks(value) {
    if (!Array.isArray(value)) return [];
    return value
        .slice(-MAX_TASKS)
        .filter(
            (t) =>
                t &&
                typeof t.id === 'string' &&
                t.track &&
                typeof t.track.id === 'string' &&
                typeof t.track.title === 'string' &&
                typeof t.track.cover === 'string' &&
                Number.isFinite(t.progress) &&
                Number.isFinite(t.totalMB) &&
                t.totalMB > 0 &&
                (t.status in statuses || t.status === 'paused'),
        )
        .map((t) => ({
            ...t,
            options: readSettings(t.options),
            warnings: Array.isArray(t.warnings)
                ? t.warnings.filter((x) => typeof x === 'string')
                : [],
            progress: Math.max(0, Math.min(100, t.progress)),
            speed: 0,
            status: t.status === 'canceling' ? 'canceled' : isPending(t) ? 'queued' : t.status,
        }));
}
