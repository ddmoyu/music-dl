export const defaults = {
    quality: 'best',
    concurrency: 3,
    directory: 'Music/拾音',
    skipDuplicates: true,
    metadata: true,
    lyrics: false,
    allowLower: true,
    organize: 'artist',
};
export const isPending = (t) => ['queued', 'downloading', 'paused'].includes(t.status);
function resolveQuality(track, settings) {
    const quality =
        settings.quality === 'best'
            ? track.quality
            : settings.quality === 'lossless'
              ? 'SQ'
              : settings.quality === 'standard'
                ? 'MP3'
                : 'HQ';
    const totalMB =
        quality === 'Hi-Res'
            ? 86.4
            : quality === 'SQ'
              ? 32.8
              : settings.quality === 'standard'
                ? 4.6
                : 10.8;
    return { quality, totalMB };
}
export function addToQueue(queue, songs, settings) {
    const next = [...queue];
    let added = 0;
    for (const track of songs) {
        if (
            next.some(
                (t) =>
                    t.track.id === track.id &&
                    (isPending(t) || (t.status === 'completed' && settings.skipDuplicates)),
            )
        )
            continue;
        const { quality, totalMB } = resolveQuality(track, settings);
        next.push({
            id: crypto.randomUUID(),
            track,
            status: 'queued',
            progress: 0,
            totalMB,
            speed: 0,
            quality,
            options: { ...settings },
        });
        added++;
    }
    return { tasks: next, added, skipped: songs.length - added };
}
/** Local prototype transport: no media request or filesystem write is made here. */
export function advanceQueue(queue, concurrency, seconds) {
    let slots = Math.max(1, Math.min(8, Math.floor(concurrency)));
    // Preserve the ordering of active work when a paused item is resumed or the limit changes.
    const admitted = new Set(
        queue
            .filter((t) => t.status === 'downloading')
            .slice(0, slots)
            .map((t) => t.id),
    );
    slots -= admitted.size;
    for (const t of queue)
        if (t.status === 'queued' && slots > 0) {
            admitted.add(t.id);
            slots--;
        }
    return queue.map((task) => {
        if (!admitted.has(task.id))
            return task.status === 'downloading' ? { ...task, status: 'queued', speed: 0 } : task;
        if (
            task.options.quality === 'lossless' &&
            task.track.quality === 'HQ' &&
            !task.options.allowLower
        ) {
            return {
                ...task,
                status: 'failed',
                speed: 0,
                error: '此歌曲暂无无损音源，可在设置中允许使用较低音质后重试。',
            };
        }
        const lowered = task.options.quality === 'lossless' && task.track.quality === 'HQ';
        const totalMB = lowered ? 10.8 : task.totalMB;
        const speed = 0.8 + (Number(task.track.id.split('-')[1]) % 5) * 0.23;
        const progress = Math.min(
            100,
            task.progress + ((speed * Math.max(0, seconds)) / totalMB) * 100,
        );
        return {
            ...task,
            quality: lowered ? 'HQ' : task.quality,
            totalMB,
            progress,
            speed: progress === 100 ? 0 : speed,
            status: progress === 100 ? 'completed' : 'downloading',
        };
    });
}
export function changeTask(queue, id, action, settings) {
    if (action === 'remove') return queue.filter((t) => t.id !== id);
    return queue.map((t) => {
        if (t.id !== id) return t;
        if (action === 'pause' && ['queued', 'downloading'].includes(t.status))
            return { ...t, status: 'paused', speed: 0 };
        if (action === 'resume' && t.status === 'paused') return { ...t, status: 'queued' };
        if (action === 'retry' && t.status === 'failed')
            return {
                ...t,
                ...resolveQuality(t.track, settings),
                status: 'queued',
                progress: 0,
                error: undefined,
                options: { ...settings },
            };
        return t;
    });
}
export function readSettings(value) {
    if (!value || typeof value !== 'object') return { ...defaults };
    const v = value;
    const result = { ...defaults };
    if (['best', 'lossless', 'high', 'standard'].includes(String(v.quality)))
        result.quality = v.quality;
    if (
        typeof v.concurrency === 'number' &&
        Number.isInteger(v.concurrency) &&
        v.concurrency >= 1 &&
        v.concurrency <= 8
    )
        result.concurrency = v.concurrency;
    if (typeof v.directory === 'string' && v.directory.trim()) result.directory = v.directory;
    if (['album', 'artist', 'flat'].includes(String(v.organize))) result.organize = v.organize;
    for (const key of ['skipDuplicates', 'metadata', 'lyrics', 'allowLower'])
        if (typeof v[key] === 'boolean') result[key] = v[key];
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
        .filter(
            (t) =>
                t &&
                typeof t.id === 'string' &&
                t.track &&
                typeof t.track.id === 'string' &&
                typeof t.track.title === 'string' &&
                typeof t.track.cover === 'string' &&
                typeof t.progress === 'number' &&
                Number.isFinite(t.progress) &&
                typeof t.totalMB === 'number' &&
                t.totalMB > 0 &&
                ['queued', 'downloading', 'paused', 'completed', 'failed'].includes(t.status),
        )
        .map((t) => ({
            ...t,
            progress: Math.max(0, Math.min(100, t.progress)),
            options: readSettings(t.options),
            speed: 0,
            status: t.status === 'downloading' ? 'queued' : t.status,
        }));
}
