import { expect, it, vi } from 'vitest';
import { searchPage } from '../../src/catalog.js';
import { Pager } from '../../src/paging.js';

const providers = (sources) =>
    sources.map((source) => ({
        source,
        enabled: true,
        capabilities: { search_playlists: { supported: true, enabled: true } },
    }));
const item = (source, id = '1') => ({ ref: { source, id }, name: `${source}-${id}` });
const response = (source, next = null, id = '1') => ({
    data: { items: [item(source, id)] },
    meta: {
        source_results: [{ source, status: 'ok', page: { has_more: !!next, next_cursor: next } }],
    },
});
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
};

it('shows the first source immediately and refills a bounded pool without waiting for slow sources', async () => {
    const requests = new Map(['a', 'b', 'c', 'd'].map((source) => [source, deferred()]));
    const api = { request: vi.fn((_, { query }) => requests.get(query.sources).promise) };
    const pager = new Pager(vi.fn());
    pager.reset(searchPage(api, providers([...requests.keys()]), 'playlists', 'all', 'query'));
    const loading = pager.load();
    expect(api.request).toHaveBeenCalledTimes(2);
    requests.get('b').resolve(response('b', 'b-next'));
    await vi.waitFor(() => expect(pager.items).toEqual([item('b')]));
    expect(pager.loading).toBe(true);
    expect(api.request).toHaveBeenCalledTimes(3);
    expect(JSON.parse(pager.cursor)).toEqual({ a: null, b: 'b-next', c: null, d: null });
    requests.get('a').resolve(response('a'));
    requests.get('c').reject(new Error('source unavailable'));
    requests.get('d').resolve(response('d'));
    await loading;
    expect(pager.items.map((entry) => entry.ref.source)).toEqual(['b', 'a', 'd']);
    expect(pager.error).toContain('source unavailable');
    expect(JSON.parse(pager.cursor)).toEqual({ b: 'b-next', c: null });
    api.request.mockImplementation(async (_, { query }) => response(query.sources, null, '2'));
    await pager.load();
    expect(pager.items).toHaveLength(5);
    expect(pager.hasMore).toBe(false);
    expect(pager.error).toBe('');
});

it('resumes unfinished sources after returning from details and ignores responses from the canceled search', async () => {
    const first = deferred(),
        oldSlow = deferred(),
        resumed = deferred();
    const api = {
        request: vi
            .fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(oldSlow.promise)
            .mockReturnValueOnce(resumed.promise),
    };
    const pager = new Pager(vi.fn());
    pager.reset(searchPage(api, providers(['a', 'b']), 'playlists', 'all', 'query'));
    const oldLoad = pager.load();
    first.resolve(response('a'));
    await vi.waitFor(() => expect(pager.items).toEqual([item('a')]));
    const checkpoint = pager.snapshot();
    pager.reset(null);
    pager.restore(checkpoint);
    expect(api.request.mock.calls[2][1].query.sources).toBe('b');
    oldSlow.resolve(response('b', null, 'stale'));
    await oldLoad;
    expect(pager.items).toEqual([item('a')]);
    resumed.resolve(response('b', null, 'current'));
    await vi.waitFor(() => expect(pager.loading).toBe(false));
    expect(pager.items).toEqual([item('a'), item('b', 'current')]);
    expect(pager.hasMore).toBe(false);
});

it('caps incremental results before notifying the view and deduplicates the final aggregate', async () => {
    const sizes = [];
    const pager = new Pager(() => sizes.push(pager.items.length));
    const items = Array.from({ length: 5010 }, (_, id) => item('a', String(id)));
    pager.reset(async (_, signal, progress) => {
        progress({ items: items.slice(0, 3000), nextCursor: 'pending' });
        progress({ items: items.slice(3000), nextCursor: null });
        return { items, nextCursor: null };
    });
    await pager.load();
    expect(Math.max(...sizes)).toBe(5000);
    expect(pager.items).toHaveLength(5000);
    expect(pager.capped).toBe(true);
    expect(pager.hasMore).toBe(false);
});
