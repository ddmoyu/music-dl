import { describe, expect, it, vi } from 'vitest';
import { PagedResults, virtualWindow } from '../app/virtual.js';
import { prepareCatalog, artists, parseLink } from '../app/catalog.js';
describe('bounded virtual scrolling and asynchronous paging', () => {
    it('renders a bounded window at the beginning, middle and end of 100,000 rows', () => {
        for (const top of [0, 640000, 6399999, 9000000]) {
            const w = virtualWindow(100000, top, 640);
            expect(w.end - w.start).toBeLessThanOrEqual(21);
            expect(w.before + (w.end - w.start) * 64 + w.after).toBe(6400000);
            expect(w.before).toBeGreaterThanOrEqual(0);
        }
        expect(virtualWindow(0).end).toBe(0);
    });
    it('ignores stale search responses, deduplicates loads, and retries a failed page', async () => {
        let resolveOld;
        const pager = new PagedResults(vi.fn());
        const old = pager.reset(
            () =>
                new Promise((resolve) => {
                    resolveOld = resolve;
                }),
        );
        const fetchNew = vi
            .fn()
            .mockResolvedValueOnce({ items: [{ id: 'new' }], total: 2, nextCursor: 1 })
            .mockRejectedValueOnce(new Error('暂时失败'))
            .mockResolvedValueOnce({ items: [{ id: 'second' }], total: 2, nextCursor: null });
        await pager.reset(fetchNew);
        resolveOld({ items: [{ id: 'stale' }], total: 1, nextCursor: null });
        await old;
        expect(pager.items.map((x) => x.id)).toEqual(['new']);
        await Promise.all([pager.load(), pager.load()]);
        expect(fetchNew).toHaveBeenCalledTimes(2);
        expect(pager.cursor).toBe(1);
        expect(pager.error).toBe('暂时失败');
        await pager.load();
        expect(pager.items.map((x) => x.id)).toEqual(['new', 'second']);
        expect(pager.hasMore).toBe(false);
    });
    it('keeps source identities and artist scope distinct and gates unsupported searches', () => {
        const result = prepareCatalog({ query: '周杰伦', type: 'artists' });
        expect(new Set(result.items.map((x) => x.id)).size).toBe(result.items.length);
        expect(result.notices.some((n) => n.source === 'qq' && n.credential)).toBe(true);
        expect(
            prepareCatalog({ query: '周杰伦', type: 'artists', source: 'fivesing' }).items,
        ).toEqual([]);
        const forest = artists.find((a) => a.title === '林间集' && a.source === 'netease');
        expect(prepareCatalog({ artist: forest }).items).toHaveLength(50);
        expect(parseLink('https://www.kuwo.cn/play_detail/228908').item.title).toBe('晴天');
        expect(parseLink('https://www.kuwo.cn/album_detail/chopin').item.kind).toBe('album');
        expect(parseLink('https://www.kuwo.cn.evil.test/play_detail/228908').error).toBeTruthy();
    });
    it('restarts an interrupted initial page when returning to an empty snapshot', async () => {
        const pager = new PagedResults(vi.fn());
        let resolveFirst;
        const fetch = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveFirst = resolve;
                    }),
            )
            .mockResolvedValueOnce({ items: [{ id: 'fresh' }], total: 1, nextCursor: null });
        const old = pager.reset(fetch);
        const saved = pager.snapshot();
        await pager.reset(null);
        pager.restore(saved);
        await vi.waitFor(() => expect(pager.loading).toBe(false));
        resolveFirst({ items: [{ id: 'stale' }], total: 1, nextCursor: null });
        await old;
        expect(pager.items.map((item) => item.id)).toEqual(['fresh']);
    });
    it('restores loaded pages and resumes the saved cursor without accepting an abandoned detail response', async () => {
        const pager = new PagedResults(vi.fn(), 1);
        const fetchList = vi
            .fn()
            .mockResolvedValueOnce({ items: [{ id: 'list-1' }], total: 2, nextCursor: 1 })
            .mockResolvedValueOnce({ items: [{ id: 'list-2' }], total: 2, nextCursor: null });
        await pager.reset(fetchList);
        const saved = pager.snapshot();
        let resolveDetail;
        const pending = pager.reset(
            () =>
                new Promise((resolve) => {
                    resolveDetail = resolve;
                }),
        );
        pager.restore(saved);
        resolveDetail({ items: [{ id: 'abandoned' }], total: 1, nextCursor: null });
        await pending;
        expect(pager.items.map((item) => item.id)).toEqual(['list-1']);
        await pager.load();
        expect(fetchList.mock.calls[1][0]).toBe(1);
        expect(pager.items.map((item) => item.id)).toEqual(['list-1', 'list-2']);
        expect(saved.items).toHaveLength(1);
        expect(pager.hasMore).toBe(false);
    });
});
