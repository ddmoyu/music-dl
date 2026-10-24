import { describe, expect, it, vi } from 'vitest';
import { Api, downloadIntent, supports, sourceLabel } from '../../src/api.js';
import { collectionPage, searchPage } from '../../src/catalog.js';
import { canTaskAction, applyTaskProjection } from '../../src/tasks.js';

describe('real service contracts', () => {
    it('does not let late snapshots or duplicate events regress task progress', () => {
        const task = {
            task_id: 'task',
            version: 3,
            status: 'downloading',
            progress: { received_bytes: 300 },
        };
        expect(applyTaskProjection(task, { task_id: 'task', version: 2, status: 'queued' })).toBe(
            task,
        );
        expect(
            applyTaskProjection(task, { task_id: 'other', version: 4, status: 'completed' }),
        ).toBe(task);
        expect(
            applyTaskProjection(task, {
                task_id: 'task',
                version: 4,
                status: 'completed',
                progress: { received_bytes: 400 },
            }),
        ).toMatchObject({ version: 4, status: 'completed', progress: { received_bytes: 400 } });
    });
    it('uses bearer headers, opaque ids and the authoritative control origin', async () => {
        const fetcher = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ data: {}, error: null }),
        }));
        const api = new Api(
            { api_base_url: 'http://127.0.0.1:12001', token: 'test-secret' },
            fetcher,
        );
        await api.request('/tracks/detail', { query: { source: 'qq', id: '009:x+y' } });
        expect(fetcher.mock.calls[0][0].pathname).toBe('/api/v1/tracks/detail');
        expect(fetcher.mock.calls[0][0].searchParams.get('id')).toBe('009:x+y');
        expect(fetcher.mock.calls[0][0].href).not.toContain('test-secret');
        expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-secret');
    });
    it('keeps idempotency keys and exposes structured backend failures', async () => {
        const fetcher = vi.fn(async () => ({
            ok: false,
            status: 409,
            json: async () => ({ error: { code: 'TASK_FINALIZING', message: '保存中' } }),
        }));
        const api = new Api({ api_base_url: 'http://127.0.0.1:1', token: 'test' }, fetcher);
        await expect(
            api.request('/downloads/id/cancel', { method: 'POST', key: 'same-key' }),
        ).rejects.toMatchObject({ code: 'TASK_FINALIZING', status: 409 });
        expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toBe('same-key');
    });
    it('submits service refs and quality policy without presentation fields', () => {
        const intent = downloadIntent(
            { ref: { source: 'qq', id: '001' }, title: 'test title', context_ref: 'ctx' },
            { quality: 'high', qualityPolicy: 'strict', destination: 'dst_default' },
        );
        expect(intent).toMatchObject({
            track: { source: 'qq', id: '001' },
            context_ref: 'ctx',
            allow_preview: false,
            quality_policy: 'strict',
        });
        expect(intent).not.toHaveProperty('title');
    });
    it('uses actual capability flags and distinct aliases', () => {
        expect(
            supports(
                { enabled: true, capabilities: { charts: { supported: true, enabled: false } } },
                'charts',
            ),
        ).toBe(false);
        expect(sourceLabel('qq')).toBe('qq');
        expect(sourceLabel('qianqian')).toBe('qqyy');
        expect(canTaskAction({ status: 'finalizing' }, 'cancel')).toBe(false);
        expect(canTaskAction({ status: 'probing' }, 'cancel')).toBe(true);
        expect(canTaskAction({ status: 'downloading' }, 'hide')).toBe(false);
        expect(canTaskAction({ status: 'completed' }, 'hide')).toBe(true);
    });
    it('reads task pagination even without a has_more field', async () => {
        const api = {
            request: vi.fn(async () => ({ data: { items: [], page: { next_cursor: 'opaque' } } })),
        };
        expect((await collectionPage(api, '/downloads', {})()).nextCursor).toBe('opaque');
    });
    it('retains separate source cursors and retries failed sources', async () => {
        const providers = ['a', 'b'].map((source) => ({
            source,
            enabled: true,
            capabilities: { search_tracks: { supported: true, enabled: true } },
        }));
        const api = {
            request: vi.fn(async (route, { query }) => {
                if (query.sources === 'b') throw Error('source unavailable');
                return {
                    data: { items: [{ ref: { source: 'a', id: '001' } }] },
                    meta: {
                        source_results: [
                            {
                                source: 'a',
                                status: 'ok',
                                page: { has_more: true, next_cursor: 'a-next' },
                            },
                        ],
                    },
                };
            }),
        };
        const load = searchPage(api, providers, 'tracks', 'all', 'query');
        const first = await load(null, new AbortController().signal);
        expect(first.items).toHaveLength(1);
        expect(first.error).toContain('source unavailable');
        expect(JSON.parse(first.nextCursor)).toEqual({ a: 'a-next', b: null });
        await load(first.nextCursor, new AbortController().signal);
        expect(api.request.mock.calls[2][1].query.cursor).toBe('a-next');
    });
});
