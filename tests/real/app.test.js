// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { savePreferences } from '../../src/preferences.js';
vi.mock('../../src/desktop.js', () => ({
    native: false,
    bootService: async () => ({
        api_base_url: 'http://127.0.0.1:12345',
        token: 'test',
        downloads: 'test-directory',
    }),
    openDownloads: vi.fn(),
}));
vi.mock('../../src/preferences.js', () => ({
    readPreferences: async () => ({}),
    savePreferences: vi.fn(async () => {}),
}));
vi.mock('../../src/tasks.js', async (importOriginal) => ({
    ...(await importOriginal()),
    watchTasks: () => () => {},
}));

it('renders real API results safely, restores collection navigation and sends actual task intent', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            disconnect() {}
        },
    );
    const track = {
        ref: { source: 'kuwo', id: '009" onmouseover="bad' },
        title: '<img src=x onerror=bad>',
        artists: [{ name: 'test artist' }],
    };
    const capabilities = Object.fromEntries(
        [
            'search_tracks',
            'search_playlists',
            'charts',
            'chart_tracks',
            'resolve_audio',
            'recommend_playlists',
        ].map((key) => [key, { supported: true, enabled: true }]),
    );
    const requests = [];
    const played = vi.fn(async () => {});
    vi.stubGlobal(
        'Audio',
        class {
            constructor(url) {
                this.src = url;
            }
            play = played;
            pause() {}
            load() {}
            removeAttribute() {}
        },
    );
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url, options) => {
            const parsed = new URL(url);
            requests.push({ path: parsed.pathname, query: parsed.searchParams, options });
            let data = {};
            let meta = {};
            if (parsed.pathname.endsWith('/providers'))
                data = {
                    items: [{ source: 'kuwo', enabled: true, auth_methods: [], capabilities }],
                };
            if (parsed.pathname.endsWith('/destinations'))
                data = {
                    items: [
                        {
                            destination_id: 'dst_default',
                            available: true,
                            accept_new_tasks: true,
                            name: 'music',
                        },
                    ],
                };
            if (parsed.pathname.endsWith('/download-policy')) data = { paused: false };
            if (parsed.pathname.endsWith('/search/tracks')) {
                data = { items: [track] };
                meta = {
                    source_results: [
                        {
                            source: 'kuwo',
                            status: 'ok',
                            page: { has_more: false, next_cursor: null },
                        },
                    ],
                };
            }
            if (parsed.pathname.endsWith('/charts')) {
                data = {
                    items: [{ ref: { source: 'kuwo', id: 'chart-id' }, name: 'chart title' }],
                };
                expect(parsed.searchParams.has('limit')).toBe(false);
            }
            if (parsed.pathname.endsWith('/charts/tracks'))
                data = { items: [track], page: { next_cursor: null } };
            if (parsed.pathname.endsWith('/download-batches'))
                data = { batch_id: 'batch-test', items: [{ task_id: 'task-test' }] };
            if (parsed.pathname.endsWith('/assets/resolve')) {
                expect(JSON.parse(options.body)).toEqual({
                    track: track.ref,
                    quality: 'standard',
                    quality_policy: 'allow_lower',
                    allow_preview: true,
                });
                data = { asset_id: 'ast_test' };
            }
            if (parsed.pathname.endsWith('/media-access')) {
                expect(JSON.parse(options.body).target).toEqual({ kind: 'asset', id: 'ast_test' });
                data = { url: 'http://127.0.0.1:12346/media/test' };
            }
            return new Response(JSON.stringify({ data, meta, error: null }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }),
    );
    await import('../../src/main.js');
    await vi.waitFor(() => expect(document.querySelector('#query')).not.toBeNull());
    const input = document.querySelector('#query');
    input.value = 'query';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document
        .querySelector('#search-form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
        expect(document.querySelector('.row-copy').textContent).toContain(track.title),
    );
    expect(document.querySelector('[onmouseover],[onerror]')).toBeNull();
    document.querySelector('[data-action^="preview:"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('footer').textContent).toContain('正在试听'),
    );
    expect(played).toHaveBeenCalledOnce();
    document.querySelector('[data-action="stop-preview"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('[data-action="stop-preview"]')).toBeNull(),
    );
    const download = document.querySelector('[data-action^="download:"]');
    expect(download.dataset.action).toContain(track.ref.id);
    savePreferences.mockRejectedValueOnce(new Error('storage write failed'));
    download.click();
    await vi.waitFor(() =>
        expect(document.querySelector('footer').textContent).toContain('任务尚未提交'),
    );
    expect(requests.some((r) => r.path.endsWith('/download-batches'))).toBe(false);
    expect(document.querySelector('[data-action="recover-submission"]')).toBeNull();
    expect(document.querySelector('[data-action^="download:"]').disabled).toBe(false);
    document.querySelector('[data-action^="download:"]').click();
    await vi.waitFor(() =>
        expect(requests.some((r) => r.path.endsWith('/download-batches'))).toBe(true),
    );
    const post = requests.find((r) => r.path.endsWith('/download-batches'));
    expect(JSON.parse(post.options.body).items[0].track).toEqual(track.ref);
    expect(JSON.parse(post.options.body).items[0]).not.toHaveProperty('fallback');
    expect(post.options.headers['Idempotency-Key']).toBeTruthy();
    document.querySelector('[data-action="nav:charts"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('.row-copy').textContent).toContain('chart title'),
    );
    document.querySelector('[data-action="open:kuwo:chart-id"]').click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="back"]')).not.toBeNull());
    document.querySelector('[data-action="back"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('.row-copy').textContent).toContain('chart title'),
    );
    expect(requests.filter((r) => r.path.endsWith('/charts'))).toHaveLength(1);
    window.dispatchEvent(new Event('beforeunload'));
    vi.unstubAllGlobals();
});
