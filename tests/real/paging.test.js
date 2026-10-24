import { expect, it, vi } from 'vitest';
import { Pager, virtualWindow } from '../../src/paging.js';
const item = (id) => ({ ref: { source: 'kw', id } });
it('discards late source responses after reset', async () => {
    const pager = new Pager(vi.fn());
    let resolve;
    pager.reset(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    const old = pager.load();
    pager.reset(async () => ({ items: [item('new')], nextCursor: null }));
    await pager.load();
    resolve({ items: [item('old')], nextCursor: 'old-next' });
    await old;
    expect(pager.items.map((i) => i.ref.id)).toEqual(['new']);
    expect(pager.hasMore).toBe(false);
});
it('preserves deduplication, selection-independent snapshots and opaque cursors', async () => {
    const pager = new Pager(vi.fn());
    pager.reset(async (cursor) =>
        cursor
            ? { items: [item('1'), item('2')], nextCursor: null }
            : { items: [item('1')], nextCursor: 'opaque' },
    );
    await pager.load();
    const saved = pager.snapshot();
    await pager.load();
    expect(pager.items).toHaveLength(2);
    pager.restore(saved);
    expect(pager.items).toHaveLength(1);
    expect(pager.cursor).toBe('opaque');
    await pager.load();
    expect(pager.items).toHaveLength(2);
});
it('keeps successful partial results while allowing failed sources to retry', async () => {
    const pager = new Pager(vi.fn());
    pager.reset(async () => ({ items: [item('a')], nextCursor: 'same', error: 'failed source' }));
    await pager.load();
    await pager.load();
    expect(pager.items).toHaveLength(1);
    expect(pager.error).toBe('failed source');
    expect(pager.hasMore).toBe(true);
});
it('does not assume an empty page is terminal and rejects a stuck cursor', async () => {
    const pager = new Pager(vi.fn());
    pager.reset(async () => ({ items: [], nextCursor: 'next' }));
    await pager.load();
    expect(pager.hasMore).toBe(true);
    await pager.load();
    expect(pager.error).toContain('游标');
});
it('bounds rendered rows for thousands of loaded results', () => {
    const result = virtualWindow(5000, 72000, 600);
    expect(result.end - result.start).toBeLessThan(22);
    expect(result.before + (result.end - result.start) * 72 + result.after).toBe(5000 * 72);
});
