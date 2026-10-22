import { describe, expect, it } from 'vitest';
import { tracks } from '../app/data.js';
import {
    addToQueue,
    advanceQueue,
    changeTask,
    defaults,
    readSettings,
    restoreTasks,
} from '../app/queue.js';
describe('parallel download queue', () => {
    it('admits only the configured number of tasks, including after lowering the limit', () => {
        let queue = addToQueue([], tracks.slice(0, 8), defaults).tasks;
        queue = advanceQueue(queue, 3, 1);
        expect(queue.filter((t) => t.status === 'downloading')).toHaveLength(3);
        expect(queue.filter((t) => t.status === 'queued')).toHaveLength(5);
        queue = advanceQueue(queue, 1, 1);
        expect(queue.filter((t) => t.status === 'downloading')).toHaveLength(1);
        expect(queue[1].progress).toBeGreaterThan(0);
    });
    it('pauses without losing progress, frees the slot, and resumes without exceeding concurrency', () => {
        let queue = advanceQueue(addToQueue([], tracks.slice(0, 4), defaults).tasks, 2, 1);
        const pausedId = queue[0].id;
        const progress = queue[0].progress;
        queue = changeTask(queue, pausedId, 'pause', defaults);
        queue = advanceQueue(queue, 2, 10);
        expect(queue[0].progress).toBe(progress);
        expect(queue[0].status).toBe('paused');
        expect(queue[2].status).toBe('downloading');
        queue = changeTask(queue, pausedId, 'resume', defaults);
        queue = advanceQueue(queue, 2, 1);
        expect(queue[0].status).toBe('queued');
        expect(queue.filter((t) => t.status === 'downloading')).toHaveLength(2);
    });
    it('completes admitted tasks and then admits waiting tasks', () => {
        let queue = addToQueue([], tracks.slice(0, 5), defaults).tasks;
        queue = advanceQueue(queue, 3, 1000);
        expect(queue.filter((t) => t.status === 'completed')).toHaveLength(3);
        queue = advanceQueue(queue, 3, 1000);
        expect(
            queue.every((t) => t.status === 'completed' && t.progress === 100 && t.speed === 0),
        ).toBe(true);
    });
    it('deduplicates overlapping batches and completed files, while permitting intentional redownload', () => {
        let queue = addToQueue([], tracks.slice(0, 3), defaults).tasks;
        let result = addToQueue(queue, tracks.slice(1, 5), defaults);
        expect(result.added).toBe(2);
        expect(result.skipped).toBe(2);
        queue = advanceQueue(result.tasks, 8, 1000);
        result = addToQueue(queue, tracks.slice(0, 2), defaults);
        expect(result.added).toBe(0);
        result = addToQueue(queue, tracks.slice(0, 2), { ...defaults, skipDuplicates: false });
        expect(result.added).toBe(2);
        expect(
            addToQueue(result.tasks, tracks.slice(0, 2), { ...defaults, skipDuplicates: false })
                .added,
        ).toBe(0);
    });
    it('reports unavailable lossless quality, retries with updated preferences, and allows lower quality', () => {
        const song = tracks.find((t) => t.quality === 'HQ');
        const strict = { ...defaults, quality: 'lossless', allowLower: false };
        let queue = advanceQueue(addToQueue([], [song], strict).tasks, 3, 1);
        expect(queue[0].status).toBe('failed');
        queue = changeTask(queue, queue[0].id, 'retry', { ...strict, allowLower: true });
        queue = advanceQueue(queue, 3, 1);
        expect(queue[0].status).toBe('downloading');
        expect(queue[0].quality).toBe('HQ');
        expect(queue[0].totalMB).toBe(10.8);
    });
    it('captures settings per task without retroactively changing already queued tasks', () => {
        const settings = { ...defaults };
        const queue = addToQueue([], [tracks[0]], settings).tasks;
        settings.quality = 'standard';
        settings.directory = 'elsewhere';
        expect(queue[0].options.quality).toBe('best');
        expect(queue[0].options.directory).toBe(defaults.directory);
    });
    it('removes a task and lets the next queued item use its slot', () => {
        let queue = advanceQueue(addToQueue([], tracks.slice(0, 2), defaults).tasks, 1, 1);
        queue = changeTask(queue, queue[0].id, 'remove', defaults);
        queue = advanceQueue(queue, 1, 1);
        expect(queue).toHaveLength(1);
        expect(queue[0].track.id).toBe(tracks[1].id);
        expect(queue[0].status).toBe('downloading');
    });
});
describe('persisted state', () => {
    it('rejects invalid settings and preserves valid preferences', () => {
        expect(
            readSettings({ concurrency: -1, quality: 'invalid', directory: '', lyrics: 'yes' }),
        ).toEqual(defaults);
        expect(readSettings({ concurrency: 8, lyrics: true }).concurrency).toBe(8);
        expect(readSettings({ concurrency: 2.5 }).concurrency).toBe(3);
        expect(readSettings(null)).toEqual(defaults);
    });
    it('restores interrupted downloads to the queue and preserves paused tasks', () => {
        let queue = advanceQueue(addToQueue([], tracks.slice(0, 2), defaults).tasks, 2, 1);
        queue = changeTask(queue, queue[1].id, 'pause', defaults);
        const restored = restoreTasks(JSON.parse(JSON.stringify(queue)));
        expect(restored[0].status).toBe('queued');
        expect(restored[0].progress).toBe(queue[0].progress);
        expect(restored[1].status).toBe('paused');
        expect(restored[0].speed).toBe(0);
        expect(restoreTasks([null, {}, { id: 'bad' }])).toEqual([]);
        expect(restoreTasks('corrupt')).toEqual([]);
    });
});
