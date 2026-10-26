import { expect, it, vi } from 'vitest';
import { TaskList } from '../../src/task-list.js';
import { TaskSync } from '../../src/task-sync.js';

const task = (id, version = 1, status = 'downloading') => ({
    task_id: id,
    version,
    status,
    created_at: `2026-10-26T01:00:0${id}Z`,
});
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
it('keeps newer event state when an older snapshot arrives and confirms terminal details', async () => {
    const page = deferred();
    const tasks = new TaskList(vi.fn());
    tasks.reset(() => page.promise);
    tasks.merge([task('1')]);
    tasks.complete = true;
    const details = deferred();
    const api = { request: vi.fn(() => details.promise) };
    const sync = new TaskSync(api, tasks, vi.fn());
    const running = sync.synchronize();
    sync.receive({ ...task('1', 3, 'completed'), progress: { received_bytes: 20 } });
    page.resolve({ items: [task('1', 2)], nextCursor: null });
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
    expect(tasks.get('1').status).toBe('completed');
    details.resolve({ data: { ...task('1', 3, 'completed'), result: { file_id: 'file' } } });
    await running;
    expect(tasks.get('1').result.file_id).toBe('file');
    expect(sync.refresh.size).toBe(0);
});

it('discards in-flight snapshots when the task list is reset', async () => {
    const page = deferred();
    const tasks = new TaskList(vi.fn());
    tasks.reset(() => page.promise);
    tasks.merge([task('1')]);
    tasks.complete = true;
    const sync = new TaskSync({ request: vi.fn() }, tasks, vi.fn());
    const running = sync.synchronize();
    tasks.reset(async () => ({ items: [], nextCursor: null }));
    page.resolve({ items: [task('2')], nextCursor: null });
    await expect(running).rejects.toThrow();
    expect(tasks.items).toEqual([]);
    expect(tasks.get('2')).toBeUndefined();
});

it('reuses filtered results, updates indexed records and sorts only additions', () => {
    const tasks = new TaskList(vi.fn());
    tasks.merge([task('1'), task('2')]);
    const hidden = new Set();
    const visible = tasks.visible(hidden, '');
    expect(tasks.visible(hidden, '')).toBe(visible);
    const sort = vi.spyOn(tasks.items, 'sort');
    tasks.merge([task('1', 2, 'completed')]);
    expect(sort).not.toHaveBeenCalled();
    expect(tasks.items.map((item) => item.task_id)).toEqual(['2', '1']);
    expect(tasks.active.has('1')).toBe(false);
    expect(tasks.visible(hidden, 'completed').map((item) => item.task_id)).toEqual(['1']);
    tasks.merge([task('3')]);
    expect(sort).toHaveBeenCalledOnce();
    expect(tasks.visible(new Set(['2']), '').map((item) => item.task_id)).toEqual(['3', '1']);
    tasks.merge([task('1', 1)]);
    expect(tasks.get('1').status).toBe('completed');
});

it('refreshes source retry details on stage changes for tasks beyond the first history page', async () => {
    const tasks = new TaskList(vi.fn());
    tasks.reset(async () => ({ items: [task('2')], nextCursor: 'older' }));
    tasks.merge([task('1'), task('2')]);
    tasks.complete = true;
    const switched = {
        ...task('1', 3, 'resolving'),
        actual_track: { source: 'qq', id: 'matched' },
        source_switched: true,
        source_retry: { pending: false, attempted_sources: ['kuwo', 'qq'] },
    };
    const api = { request: vi.fn(async () => ({ data: switched })) };
    const sync = new TaskSync(api, tasks, vi.fn());
    sync.receive(task('1', 2, 'waiting_retry'));
    expect(sync.refresh.has('1')).toBe(true);
    sync.receive(task('1', 3, 'resolving'));
    await sync.synchronize();
    expect(api.request.mock.calls[0][0]).toBe('/downloads/1');
    expect(tasks.get('1')).toMatchObject(switched);
    expect(sync.refresh.size).toBe(0);
});
