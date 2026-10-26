import { afterEach, expect, it, vi } from 'vitest';
import { Preview } from '../../src/preview.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
const track = (id) => ({ ref: { source: 'kuwo', id } });
it('aborts stopped resolution and ignores its late failure while the next track plays', async () => {
    let reject;
    const slow = new Promise((_, fail) => {
        reject = fail;
    });
    const api = {
        request: vi
            .fn()
            .mockReturnValueOnce(slow)
            .mockResolvedValueOnce({ data: { asset_id: 'asset' } })
            .mockResolvedValueOnce({ data: { url: 'http://localhost/media' } }),
    };
    const played = vi.fn().mockResolvedValue();
    vi.stubGlobal(
        'Audio',
        class {
            play = played;
            pause() {}
            removeAttribute() {}
            load() {}
        },
    );
    const player = new Preview(api, vi.fn(), vi.fn());
    const first = player.play(track('1'), 'first');
    const signal = api.request.mock.calls[0][1].signal;
    await player.play(track('2'), 'second');
    expect(signal.aborted).toBe(true);
    reject(new Error('late network failure'));
    await expect(first).resolves.toBeUndefined();
    expect(player.title).toBe('second');
    expect(player.id).toBe('kuwo:2');
    expect(played).toHaveBeenCalledOnce();
    player.stop();
});

function setupPreview(request, play = () => Promise.resolve()) {
    const audios = [];
    vi.stubGlobal(
        'Audio',
        class {
            constructor(url) {
                this.src = url;
                audios.push(this);
            }
            play = vi.fn(play);
            pause = vi.fn();
            removeAttribute = vi.fn();
            load = vi.fn();
        },
    );
    const api = { request: vi.fn(request) };
    const change = vi.fn();
    const report = vi.fn();
    return { api, player: new Preview(api, change, report), audios, change, report };
}
const asset = (source, attempted) => ({
    data: {
        asset_id: `asset-${source}`,
        actual_track: { source, id: `${source}-matched` },
        source_retry: { attempted_sources: attempted },
    },
});
const media = { data: { url: 'http://localhost/media' } };
const nextAction = { field: 'next_action', reason: '/api/v1/assets/switch-source' };
const failure = (code, sources = [], hint = false) =>
    Object.assign(new Error(code), {
        code,
        details: [
            ...sources.map((reason) => ({ field: 'attempted_sources', reason })),
            ...(hint ? [nextAction] : []),
        ],
    });

it('switches explicitly using the original track and all successful or failed attempted sources', async () => {
    const { api, player, audios } = setupPreview();
    api.request
        .mockRejectedValueOnce(failure('UPSTREAM_TIMEOUT', [], true))
        .mockResolvedValueOnce(asset('qq', ['kuwo', 'netease', 'qq']))
        .mockResolvedValueOnce(media)
        .mockRejectedValueOnce(failure('REQUEST_DEADLINE_EXCEEDED', ['qq', 'kugou']))
        .mockResolvedValueOnce(asset('migu', ['migu']))
        .mockResolvedValueOnce(media);
    const original = { ...track('1'), context_ref: 'original-context' };
    await player.play(original, 'original');
    expect(player.status).toBe('failed');
    expect(player.canSwitch).toBe(true);
    expect(api.request).toHaveBeenCalledOnce();
    await player.switchSource();
    expect(player.message).toContain('已切换到 qq');
    expect(api.request.mock.calls[1]).toEqual([
        '/assets/switch-source',
        expect.objectContaining({
            body: {
                track: original.ref,
                attempted_sources: ['kuwo'],
                quality: 'standard',
                quality_policy: 'allow_lower',
                allow_preview: true,
            },
        }),
    ]);
    expect(api.request.mock.calls[2][1].body.target.id).toBe('asset-qq');
    await player.switchSource();
    expect(audios[0].pause).toHaveBeenCalledOnce();
    expect(audios[0].onerror).toBeNull();
    expect(player.status).toBe('failed');
    expect(player.canSwitch).toBe(true);
    await player.switchSource();
    expect(api.request.mock.calls[4][1].body).toMatchObject({
        track: original.ref,
        attempted_sources: ['kuwo', 'netease', 'qq', 'kugou'],
    });
    expect(player.message).toContain('已切换到 mg');
    expect(player.id).toBe('kuwo:1');
    player.stop();
});

it('retains a switch action for media errors and stops at source exhaustion without looping', async () => {
    const { api, player, audios, report } = setupPreview();
    api.request
        .mockResolvedValueOnce(asset('kuwo', ['kuwo']))
        .mockResolvedValueOnce(media)
        .mockRejectedValueOnce(failure('SOURCE_EXHAUSTED', ['kuwo', 'qq', 'netease'], true));
    await player.play(track('1'), 'song');
    audios[0].onerror();
    expect(audios[0].pause).toHaveBeenCalledOnce();
    expect(player.status).toBe('failed');
    expect(player.canSwitch).toBe(true);
    expect(report).toHaveBeenCalledOnce();
    expect(api.request).toHaveBeenCalledTimes(2);
    await player.switchSource();
    expect(player.canSwitch).toBe(false);
    expect(player.message).toContain('没有可用的匹配音源');
    expect([...player.attemptedSources]).toEqual(['kuwo', 'qq', 'netease']);
    await player.switchSource();
    expect(api.request).toHaveBeenCalledTimes(3);
    player.stop();
});

it('does not offer a source switch for validation failures without a backend hint', async () => {
    const { api, player } = setupPreview();
    api.request.mockRejectedValueOnce(failure('VALIDATION_FAILED'));
    await player.play(track('1'), 'song');
    expect(player.canSwitch).toBe(false);
    expect(player.message).toContain('VALIDATION_FAILED');
    await player.switchSource();
    expect(api.request).toHaveBeenCalledOnce();
    player.stop();
});

it('retries the original song when its play button is pressed after a failure', async () => {
    const { api, player } = setupPreview();
    api.request
        .mockRejectedValueOnce(failure('UPSTREAM_TIMEOUT', [], true))
        .mockResolvedValueOnce(asset('kuwo', ['kuwo']))
        .mockResolvedValueOnce(media);
    await player.play(track('1'), 'song');
    expect(player.status).toBe('failed');
    await player.play(track('1'), 'song');
    expect(player.status).toBe('playing');
    expect(api.request.mock.calls.map(([route]) => route)).toEqual([
        '/assets/resolve',
        '/assets/resolve',
        '/media-access',
    ]);
    player.stop();
});

it('bounds media loading time, releases the stalled audio and allows explicit switching', async () => {
    vi.useFakeTimers();
    const { api, player, audios, report } = setupPreview(undefined, () => new Promise(() => {}));
    api.request.mockResolvedValueOnce(asset('kuwo', ['kuwo'])).mockResolvedValueOnce(media);
    const stalled = player.play(track('2'), 'stalled');
    await vi.advanceTimersByTimeAsync(14999);
    expect(player.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await stalled;
    expect(player.busy).toBe(false);
    expect(player.status).toBe('failed');
    expect(player.message).toContain('加载超时');
    expect(player.canSwitch).toBe(true);
    expect(player.audio).toBeNull();
    expect(audios[0].pause).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledOnce();
    player.stop();
});

it('cancels source switching, ignores late results and resets exclusions for a different song', async () => {
    let resolveSwitch;
    const { api, player, audios } = setupPreview();
    api.request
        .mockResolvedValueOnce(asset('kuwo', ['kuwo']))
        .mockResolvedValueOnce(media)
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveSwitch = resolve;
                }),
        )
        .mockResolvedValueOnce(asset('kuwo', ['kuwo']))
        .mockResolvedValueOnce(media);
    await player.play(track('1'), 'first');
    const switching = player.switchSource();
    expect(audios[0].pause).toHaveBeenCalledOnce();
    await player.switchSource();
    expect(api.request).toHaveBeenCalledTimes(3);
    const signal = api.request.mock.calls[2][1].signal;
    player.stop();
    expect(signal.aborted).toBe(true);
    await player.play(track('2'), 'second');
    resolveSwitch(asset('qq', ['kuwo', 'qq']));
    await switching;
    expect(player.title).toBe('second');
    expect(player.source).toBe('kuwo');
    expect([...player.attemptedSources]).toEqual(['kuwo']);
    expect(api.request).toHaveBeenCalledTimes(5);
    player.stop();
    expect(player.message).toBe('');
    expect(player.canSwitch).toBe(false);
    expect(player.attemptedSources.size).toBe(0);
});

it('settles a pending media play when stopped and ignores its late rejection', async () => {
    let rejectPlay;
    const play = new Promise((_, reject) => {
        rejectPlay = reject;
    });
    const { api, player, audios, report } = setupPreview(undefined, () => play);
    api.request.mockResolvedValueOnce(asset('kuwo', ['kuwo'])).mockResolvedValueOnce(media);
    const loading = player.play(track('1'), 'song');
    await vi.waitFor(() => expect(audios).toHaveLength(1));
    player.stop();
    await loading;
    rejectPlay(new Error('late media failure'));
    await Promise.resolve();
    expect(player.status).toBe('idle');
    expect(player.message).toBe('');
    expect(report).not.toHaveBeenCalled();
});
