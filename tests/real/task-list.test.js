import { expect, it, vi } from 'vitest';
import { TaskList, collectTasks } from '../../src/task-list.js';

const task = (id, version = 1) => ({ task_id: String(id), version });

it('loads every page beyond 5000 items before publishing the complete count', async () => {
    const snapshots = [];
    const list = new TaskList(() => snapshots.push(list.items.length));
    const fetchPage = vi.fn(async (cursor) => {
        const start = cursor ?? 0;
        return {
            items: Array.from({ length: Math.min(100, 5101 - start) }, (_, i) => task(start + i)),
            nextCursor: start + 100 < 5101 ? start + 100 : null,
        };
    });
    list.reset(fetchPage);
    await list.load();
    expect(list.complete).toBe(true);
    expect(list.items).toHaveLength(5101);
    expect(fetchPage).toHaveBeenCalledTimes(52);
    expect(snapshots).toEqual([0, 5101]);
});

it('does not publish a partial total after failure and retries the entire collection', async () => {
    const list = new TaskList(() => {});
    const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ items: [task(1)], nextCursor: 'second' })
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce({ items: [task(1), task(2)], nextCursor: null });
    list.reset(fetchPage);
    await list.load();
    expect(list.items).toEqual([]);
    expect(list.complete).toBe(false);
    expect(list.error).toBe('network');
    await list.load();
    expect(fetchPage.mock.calls[2][0]).toBeNull();
    expect(list.items).toHaveLength(2);
    expect(list.complete).toBe(true);
    expect(list.error).toBe('');
});

it('ignores late replies from an aborted load and prevents overlapping loads', async () => {
    let resolve;
    const oldPage = vi.fn(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    const list = new TaskList(() => {});
    list.reset(oldPage);
    const oldLoad = list.load();
    await list.load();
    expect(oldPage).toHaveBeenCalledTimes(1);
    const oldSignal = oldPage.mock.calls[0][1];
    list.reset(async () => ({ items: [task('new')], nextCursor: null }));
    await list.load();
    resolve({ items: [task('old')], nextCursor: 'more' });
    await oldLoad;
    expect(oldSignal.aborted).toBe(true);
    expect(list.items).toEqual([task('new')]);
    expect(list.complete).toBe(true);
});

it('rejects cyclic cursors instead of fetching forever', async () => {
    const fetchPage = vi.fn(async (cursor) => ({
        items: [],
        nextCursor: cursor === 'a' ? 'b' : 'a',
    }));
    await expect(collectTasks(fetchPage, new AbortController().signal)).rejects.toThrow('游标重复');
    expect(fetchPage).toHaveBeenCalledTimes(3);
});

it('synchronizes all new pages up to known history and keeps the latest duplicate', async () => {
    const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ items: [task(3, 2)], nextCursor: 'second' })
        .mockResolvedValueOnce({ items: [task(3), task(2)], nextCursor: 'third' })
        .mockResolvedValueOnce({ items: [task(1)], nextCursor: 'older' });
    const items = await collectTasks(fetchPage, new AbortController().signal, new Set(['1']));
    expect(items).toEqual([task(3, 2), task(2), task(1)]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
});
