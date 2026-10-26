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
        pay: { pay_play: 1, pay_down: null, pay_month: 1 },
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
    const credentials = [
        { credential_id: 'revoked-cookie', source: 'qq', label: 'old cookie', status: 'revoked' },
        { credential_id: 'active-cookie', source: 'qq', label: 'current cookie', status: 'active' },
    ];
    const played = vi.fn(async () => {});
    const paused = vi.fn();
    let currentAudio;
    vi.stubGlobal(
        'Audio',
        class {
            constructor(url) {
                this.src = url;
                currentAudio = this;
            }
            play = played;
            pause = paused;
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
                    items: [
                        {
                            source: 'kuwo',
                            enabled: true,
                            auth_methods: [
                                {
                                    kind: 'cookie',
                                    auth_profile: 'web_cookie',
                                    supports_verify: true,
                                },
                            ],
                            capabilities,
                        },
                    ],
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
            if (parsed.pathname.endsWith('/downloads')) {
                expect(parsed.searchParams.has('status')).toBe(false);
                const offset = Number(parsed.searchParams.get('cursor') || 0);
                data = {
                    items: Array.from({ length: Math.min(100, 205 - offset) }, (_, index) => ({
                        task_id: `task-${offset + index}`,
                        version: 1,
                        status:
                            offset + index === 2
                                ? 'waiting_retry'
                                : (offset + index) % 2
                                  ? 'failed'
                                  : 'completed',
                        original_track: { source: 'kuwo', id: String(offset + index) },
                        actual_track: {
                            source: offset + index === 0 ? 'netease' : 'kuwo',
                            id: String(offset + index),
                        },
                        source_switched: offset + index === 0,
                        source_retry: {
                            pending: offset + index === 2,
                            attempted_sources:
                                offset + index === 0 ? ['kuwo', 'qq', 'netease'] : ['kuwo'],
                        },
                        created_at: '2026-10-26T01:00:00Z',
                    })),
                    page: { next_cursor: offset + 100 < 205 ? String(offset + 100) : null },
                };
            }
            if (parsed.pathname.endsWith('/credentials')) {
                if (options.method === 'POST') {
                    const body = JSON.parse(options.body);
                    expect(body).toMatchObject({
                        source: 'kuwo',
                        enabled: true,
                        secret: { cookie: 'synthetic-cookie' },
                    });
                    const created = {
                        credential_id: 'new-kw',
                        source: 'kuwo',
                        label: body.label,
                        auth_profile: body.auth_profile,
                        enabled: true,
                        status: 'active',
                        version: 1,
                        login_status: 'unknown',
                        verification: { id: 'check-new', state: 'pending' },
                        membership: { status: 'unknown' },
                    };
                    credentials.push(created);
                    data = created;
                } else data = { items: credentials };
            }
            const kw = credentials.find((item) => item.credential_id === 'new-kw');
            if (parsed.pathname.includes('/credential-defaults/')) {
                if (options.method === 'PUT') {
                    expect(JSON.parse(options.body)).toMatchObject({
                        credential_id: 'new-kw',
                        secret: { cookie: 'renewed-cookie' },
                    });
                    kw.enabled = true;
                    kw.version++;
                    kw.verification = { id: 'check-renewed', state: 'complete' };
                    kw.login_status = 'valid';
                    kw.membership = {
                        status: 'active',
                        name: '豪华VIP',
                        expiry_precision: 'date',
                        expires_on: '2026-10-27',
                    };
                }
                data = {
                    credential_id: kw?.enabled ? kw.credential_id : null,
                    selection_version: 1,
                };
            }
            if (parsed.pathname.endsWith('/credentials/new-kw/verify/check-new/cancel')) {
                kw.verification = { id: 'check-new', state: 'complete', error_code: 'CANCELED' };
                data = kw;
            }
            if (parsed.pathname.endsWith('/credentials/new-kw/disable')) {
                kw.enabled = false;
                kw.version++;
                kw.verification = { id: null, state: 'idle' };
                data = kw;
            }
            if (
                parsed.pathname.endsWith('/credentials/active-cookie') &&
                options.method === 'DELETE'
            ) {
                credentials[1].status = 'revoked';
                data = credentials[1];
            }
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
            if (parsed.pathname.endsWith('/assets/switch-source')) {
                expect(JSON.parse(options.body)).toEqual({
                    track: track.ref,
                    attempted_sources: ['kuwo'],
                    quality: 'standard',
                    quality_policy: 'allow_lower',
                    allow_preview: true,
                });
                data = {
                    asset_id: 'ast_switched',
                    actual_track: { source: 'netease', id: 'matched' },
                    source_switched: true,
                    source_retry: { attempted_sources: ['kuwo', 'qq', 'netease'] },
                };
            }
            if (parsed.pathname.endsWith('/media-access')) {
                expect(['ast_test', 'ast_switched']).toContain(JSON.parse(options.body).target.id);
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
    expect(document.querySelector('.pay-badge').textContent).toBe('VIP');
    expect(document.querySelector('[data-action^="preview:"]').disabled).toBe(false);
    expect(document.querySelector('[data-action^="download:"]').disabled).toBe(false);
    document.querySelector('[data-action^="preview:"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('footer').textContent).toContain('正在试听'),
    );
    expect(played).toHaveBeenCalledOnce();
    const playingAudio = currentAudio;
    for (const view of ['settings', 'downloads', 'recommendations', 'search']) {
        document.querySelector(`[data-action="nav:${view}"]`).click();
        await vi.waitFor(() =>
            expect(
                document.querySelector(`[data-action="nav:${view}"]`).classList.contains('active'),
            ).toBe(true),
        );
        expect(document.querySelector('footer').textContent).toContain('正在试听');
        expect(document.querySelector('[data-action="stop-preview"]')).not.toBeNull();
        expect(currentAudio).toBe(playingAudio);
        expect(paused).not.toHaveBeenCalled();
        expect(played).toHaveBeenCalledOnce();
        if (view === 'downloads') {
            await vi.waitFor(() =>
                expect(document.querySelector('.list-tools label').textContent).toContain('205 项'),
            );
            const requestsBefore = requests.filter((request) =>
                request.path.endsWith('/downloads'),
            ).length;
            expect(requestsBefore).toBe(3);
            expect(document.querySelectorAll('.task-row').length).toBeLessThan(25);
            expect(document.querySelector('[data-task="task-0"] .row-copy p').textContent).toBe(
                'kw → wyy',
            );
            expect(document.querySelector('[data-task="task-0"] .row-copy p').title).toContain(
                '已尝试 kw / qq / wyy',
            );
            expect(document.querySelector('[data-task="task-2"] .status').textContent).toBe(
                '等待换源',
            );
            expect(document.querySelector('[data-action="load-more"]')).toBeNull();
            document.querySelector('#select-tasks').click();
            expect(document.querySelector('.list-tools label').textContent).toContain(
                '已选 205 / 205 项',
            );
            document.querySelector('[data-action="filter:failed"]').click();
            await vi.waitFor(() =>
                expect(document.querySelector('.list-tools label').textContent).toContain('102 项'),
            );
            expect(document.querySelector('.list-tools label').textContent).not.toContain('已选');
            document.querySelector('[data-action="filter:"]').click();
            await vi.waitFor(() =>
                expect(document.querySelector('.list-tools label').textContent).toContain('205 项'),
            );
            const viewport = document.querySelector('.viewport');
            Object.defineProperty(viewport, 'clientHeight', { value: 400, configurable: true });
            viewport.scrollTop = 200 * 84;
            viewport.dispatchEvent(new Event('scroll'));
            await vi.waitFor(() =>
                expect(document.querySelector('[data-task="task-204"]')).not.toBeNull(),
            );
            expect(document.querySelectorAll('.task-row').length).toBeLessThan(25);
            expect(requests.filter((request) => request.path.endsWith('/downloads')).length).toBe(
                requestsBefore,
            );
        }
    }
    await vi.waitFor(() =>
        expect(document.querySelector('[data-action^="preview:"]')).not.toBeNull(),
    );
    let previewButton = document.querySelector('[data-action^="preview:"]');
    expect(previewButton.getAttribute('aria-label')).toBe(`停止试听 ${track.title}`);
    expect(previewButton.querySelector('svg rect')).not.toBeNull();
    previewButton.click();
    await vi.waitFor(() =>
        expect(document.querySelector('[data-action="stop-preview"]')).toBeNull(),
    );
    expect(paused).toHaveBeenCalledOnce();
    expect(played).toHaveBeenCalledOnce();
    previewButton = document.querySelector('[data-action^="preview:"]');
    expect(previewButton.getAttribute('aria-label')).toBe(`试听 ${track.title}`);
    expect(previewButton.querySelector('svg polygon')).not.toBeNull();
    previewButton.click();
    await vi.waitFor(() => expect(currentAudio.onended).toBeTypeOf('function'));
    currentAudio.onended();
    await vi.waitFor(() =>
        expect(
            document.querySelector('[data-action^="preview:"]').getAttribute('aria-pressed'),
        ).toBe('false'),
    );
    expect(document.querySelector('[data-action="stop-preview"]')).toBeNull();
    document.querySelector('[data-action^="preview:"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('[data-action="stop-preview"]')).not.toBeNull(),
    );
    await vi.waitFor(() =>
        expect(document.querySelector('footer').textContent).toContain('正在试听'),
    );
    document.querySelector('[data-action="switch-preview"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('footer').textContent).toContain('已切换到 wyy'),
    );
    expect(document.querySelector('[data-action="switch-preview"]').title).toContain(
        '已尝试 kw / qq / wyy',
    );
    expect(
        requests.filter((request) => request.path.endsWith('/assets/switch-source')),
    ).toHaveLength(1);
    document.querySelector('[data-action="nav:settings"]').click();
    await vi.waitFor(() => expect(document.querySelector('#credential-form')).not.toBeNull());
    expect(document.querySelector('footer').textContent).toContain('已切换到 wyy');
    document.querySelector('[data-action="stop-preview"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('[data-action="stop-preview"]')).toBeNull(),
    );
    document.querySelector('[data-action="nav:search"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('[data-action^="preview:"]')).not.toBeNull(),
    );
    expect(document.querySelector('[data-action^="preview:"]').getAttribute('aria-pressed')).toBe(
        'false',
    );
    document.querySelector('[data-action="nav:settings"]').click();
    await vi.waitFor(() => expect(document.querySelector('#quality')).not.toBeNull());
    savePreferences.mockRejectedValueOnce(new Error('settings disk full'));
    const quality = document.querySelector('#quality');
    quality.value = 'high';
    quality.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() =>
        expect(document.querySelector('footer').textContent).toContain('settings disk full'),
    );
    expect(document.querySelector('#quality').value).toBe('standard');
    document.querySelector('[data-action="nav:search"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('[data-action^="download:"]')).not.toBeNull(),
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
    expect(JSON.parse(post.options.body).items[0].quality).toBe('standard');
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
    document.querySelector('[data-action="nav:settings"]').click();
    await vi.waitFor(() => expect(document.querySelector('#credential-form')).not.toBeNull());
    expect(document.querySelector('[data-action="credential-delete:revoked-cookie"]')).toBeNull();
    expect(
        document.querySelector('[data-action="credential-delete:active-cookie"]'),
    ).not.toBeNull();
    vi.stubGlobal('confirm', () => true);
    document.querySelector('[data-action="credential-delete:active-cookie"]').click();
    await vi.waitFor(() => expect(document.querySelector('.credential')).toBeNull());
    expect(
        requests.some(
            (r) => r.path.endsWith('/credentials/active-cookie') && r.options.method === 'DELETE',
        ),
    ).toBe(true);
    document.querySelector('[data-action="nav:downloads"]').click();
    await vi.waitFor(() => expect(document.querySelector('#credential-form')).toBeNull());
    document.querySelector('[data-action="nav:settings"]').click();
    await vi.waitFor(() => expect(document.querySelector('#credential-form')).not.toBeNull());
    expect(document.querySelector('.credential')).toBeNull();
    expect(document.querySelector('#credential-source').value).toBe('kuwo');
    document.querySelector('#cookie').value = 'synthetic-cookie';
    document.querySelector('#credential-label').value = 'kw account';
    document
        .querySelector('#credential-form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
        expect(document.querySelector('.credential')?.textContent).toContain('校验中'),
    );
    await vi.waitFor(() =>
        expect(document.querySelector('[data-action="credential-cancel:new-kw"]').disabled).toBe(
            false,
        ),
    );
    expect(document.querySelector('#cookie').value).toBe('');
    expect(
        requests.some(
            (r) => r.path.includes('/credential-defaults/') && r.options.method === 'PUT',
        ),
    ).toBe(false);
    document.querySelector('[data-action="credential-cancel:new-kw"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('.credential').textContent).toContain('校验已取消'),
    );
    await vi.waitFor(() =>
        expect(document.querySelector('[data-action="credential-disable:new-kw"]').disabled).toBe(
            false,
        ),
    );
    document.querySelector('[data-action="credential-disable:new-kw"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('.credential').textContent).toContain('已停用'),
    );
    await vi.waitFor(() =>
        expect(document.querySelector('[data-action="credential-edit:new-kw"]').disabled).toBe(
            false,
        ),
    );
    document.querySelector('[data-action="credential-edit:new-kw"]').click();
    await vi.waitFor(() =>
        expect(document.querySelector('#credential-source').disabled).toBe(true),
    );
    await vi.waitFor(() =>
        expect(document.querySelector('#credential-form button[type="submit"]').disabled).toBe(
            false,
        ),
    );
    document.querySelector('#cookie').value = 'renewed-cookie';
    document
        .querySelector('#credential-form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
        expect(document.querySelector('.credential').textContent).toContain('已登录'),
    );
    expect(document.querySelector('.credential').textContent).toContain(
        '豪华VIP · 2026-10-27 到期',
    );
    document.querySelector('[data-action="nav:downloads"]').click();
    await vi.waitFor(() => expect(document.querySelector('.task-row')).not.toBeNull());
    savePreferences.mockRejectedValueOnce(new Error('history disk full'));
    const taskId = document.querySelector('.task-row').dataset.task;
    document.querySelector(`[data-action="hide:${taskId}"]`).click();
    await vi.waitFor(() =>
        expect(document.querySelector('footer').textContent).toContain('history disk full'),
    );
    expect(document.querySelector('.list-tools label').textContent).toContain('205 项');
    expect(document.querySelector(`[data-task="${taskId}"]`)).not.toBeNull();
    document.querySelector(`[data-action="hide:${taskId}"]`).click();
    await vi.waitFor(() =>
        expect(document.querySelector('.list-tools label').textContent).toContain('204 项'),
    );
    expect(document.querySelector(`[data-task="${taskId}"]`)).toBeNull();
    window.dispatchEvent(new Event('beforeunload'));
    vi.unstubAllGlobals();
});
