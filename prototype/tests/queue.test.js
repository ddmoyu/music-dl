import { describe, expect, it } from 'vitest';
import { catalogTracks } from '../app/catalog.js';
import {
    addToQueue,
    advanceQueue,
    changeTask,
    defaults,
    readSettings,
    restoreTasks,
    MAX_ACTIVE,
} from '../app/queue.js';
const tracks = catalogTracks.filter((t) => t.source === 'kuwo' && t.access === 'unknown');
const steps = (queue, n, seconds = 1, paused = false) => {
    for (let i = 0; i < n; i++) queue = advanceQueue(queue, 3, seconds, paused);
    return queue;
};
describe('service-aligned prototype queue', () => {
    it('bounds running work and pauses only admission, while current work continues', () => {
        let queue = steps(addToQueue([], tracks.slice(0, 8), defaults).tasks, 3);
        expect(queue.filter((t) => t.status === 'downloading')).toHaveLength(3);
        queue = steps(queue, 1, 1, true);
        expect(queue[0].progress).toBeGreaterThan(0);
        expect(queue.filter((t) => t.status === 'queued')).toHaveLength(5);
        queue = steps(queue, 4, 1000, true);
        expect(queue.filter((t) => t.status === 'completed')).toHaveLength(3);
        expect(queue.filter((t) => t.status === 'queued')).toHaveLength(5);
        queue = steps(queue, 1);
        expect(queue.filter((t) => t.status === 'resolving')).toHaveLength(3);
    });
    it('cancels queued work immediately and running work asynchronously without deleting history', () => {
        let queue = steps(addToQueue([], tracks.slice(0, 4), defaults).tasks, 3);
        queue = changeTask(queue, queue[3].id, 'cancel', defaults);
        expect(queue[3].status).toBe('canceled');
        queue = changeTask(queue, queue[0].id, 'cancel', defaults);
        expect(queue[0].status).toBe('canceling');
        queue = steps(queue, 1);
        expect(queue[0].status).toBe('canceled');
        expect(queue).toHaveLength(4);
    });
    it('preserves failed intent on retry and creates a new task; changed preferences require redownload', () => {
        const song = tracks.find((t) => t.quality === 'HQ');
        const strict = { ...defaults, quality: 'lossless', allowLower: false };
        let queue = steps(addToQueue([], [song], strict).tasks, 2);
        expect(queue[0].status).toBe('failed');
        queue = changeTask(queue, queue[0].id, 'retry', { ...strict, allowLower: true });
        expect(queue).toHaveLength(2);
        expect(queue[1].retryOf).toBe(queue[0].id);
        expect(queue[1].options.allowLower).toBe(false);
        queue = steps(queue, 2);
        expect(queue[1].status).toBe('failed');
        queue = changeTask(queue, queue[0].id, 'redownload', { ...strict, allowLower: true });
        queue = steps(queue, 3);
        expect(queue[2].status).toBe('downloading');
        expect(queue[2].quality).toBe('high');
        expect(queue[2].warnings).toContain('已使用较低音质');
    });
    it('deduplicates identical intents without conflating different qualities or sources', () => {
        let queue = addToQueue([], tracks.slice(0, 3), defaults).tasks;
        expect(addToQueue(queue, tracks.slice(1, 5), defaults).added).toBe(2);
        expect(addToQueue(queue, [tracks[0]], { ...defaults, quality: 'standard' }).added).toBe(1);
        queue = steps(queue, 8, 1000);
        expect(addToQueue(queue, [tracks[0]], defaults).skipped).toBe(1);
        expect(addToQueue(queue, [tracks[0]], { ...defaults, skipDuplicates: false }).added).toBe(
            1,
        );
    });
    it('rejects restricted, login-only and disallowed preview resources, reports overflow', () => {
        const blocked = ['restricted', 'login', 'preview'].map((access, i) => ({
            ...tracks[0],
            id: `blocked:${i}`,
            access,
        }));
        expect(addToQueue([], blocked, defaults).unavailable).toBe(3);
        expect(addToQueue([], blocked, { ...defaults, allowPreview: true }).added).toBe(1);
        const result = addToQueue([], tracks.slice(0, MAX_ACTIVE + 20), defaults);
        expect(result.added).toBe(MAX_ACTIVE);
        expect(result.capacity).toBe(20);
    });
    it('captures only valid preferences and migrates interrupted legacy states', () => {
        expect(
            readSettings({
                concurrency: 8,
                directory: 'D:/music',
                quality: 'bad',
                token: 'secret',
            }),
        ).toEqual(defaults);
        expect(readSettings({ quality: 'hires', destination: 'offline' })).toEqual({
            ...defaults,
            quality: 'hires',
        });
        expect(readSettings({ serviceUrl: 'https://secret@example.com' }).serviceUrl).toBe(
            defaults.serviceUrl,
        );
        const queue = addToQueue([], tracks.slice(0, 2), defaults).tasks;
        queue[0].status = 'downloading';
        queue[0].progress = 28;
        queue[1].status = 'paused';
        const restored = restoreTasks(queue);
        expect(restored.map((t) => t.status)).toEqual(['queued', 'queued']);
        expect(restored[0].progress).toBe(28);
        expect(restoreTasks([null, {}, { id: 'bad' }])).toEqual([]);
    });
});
