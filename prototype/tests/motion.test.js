// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { createMotion } from '../app/motion.js';

it('animates navigation once without repeating on progress, typing or selection', () => {
    const animation = { cancel: vi.fn(), finished: Promise.resolve() };
    const animate = vi.fn(() => animation);
    const root = { querySelector: vi.fn(() => ({ animate })) };
    const update = createMotion(root);
    const state = {
        view: 'search',
        query: '',
        searchType: 'tracks',
        source: '全部来源',
        downloadTab: '进行中',
    };
    update(state);
    expect(animate).not.toHaveBeenCalled();
    state.query = '周杰伦';
    update(state);
    expect(animate).toHaveBeenCalledTimes(1);
    update({
        ...state,
        search: '新的输入',
        selected: new Set(['track-1']),
        tasks: [{ progress: 25 }],
    });
    expect(animate).toHaveBeenCalledTimes(1);
    state.view = 'settings';
    update(state);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animation.cancel).toHaveBeenCalledTimes(1);
});

it('honors reduced motion and cancels an active transition when the preference changes', () => {
    let onChange;
    const preference = {
        matches: false,
        addEventListener: (_, listener) => {
            onChange = listener;
        },
    };
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue(preference);
    const animation = { cancel: vi.fn(), finished: Promise.resolve() };
    const animate = vi.fn(() => animation);
    try {
        const update = createMotion({ querySelector: () => ({ animate }) });
        update({ view: 'search' });
        update({ view: 'settings' });
        expect(animate).toHaveBeenCalledTimes(1);
        preference.matches = true;
        onChange();
        expect(animation.cancel).toHaveBeenCalledTimes(1);
        update({ view: 'downloads' });
        expect(animate).toHaveBeenCalledTimes(1);
    } finally {
        media.mockRestore();
    }
});

it('waits for the first page and does not replay on appended pages or recycled rows', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() }));
    const update = createMotion({ querySelector: () => ({ animate }) });
    const state = { view: 'search', query: '', pager: { loading: false, items: [] } };
    update(state);
    state.query = '林间集';
    state.pager.loading = true;
    update(state);
    update({ ...state, search: '继续输入' });
    expect(animate).not.toHaveBeenCalled();
    state.pager = { loading: false, items: [{ id: 'first' }] };
    update(state);
    expect(animate).toHaveBeenCalledTimes(1);
    state.pager.loading = true;
    update(state);
    state.pager = { loading: false, items: [{ id: 'first' }, { id: 'next' }] };
    update(state);
    update({ ...state, viewport: { top: 2900, height: 400 } });
    expect(animate).toHaveBeenCalledTimes(1);
});

it('discards a pending list transition when navigating away or reducing motion', () => {
    let onChange;
    const preference = {
        matches: false,
        addEventListener: (_, listener) => {
            onChange = listener;
        },
    };
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue(preference);
    const animation = { cancel: vi.fn(), finished: Promise.resolve() };
    const animate = vi.fn(() => animation);
    const root = { querySelector: vi.fn(() => ({ animate })) };
    try {
        const update = createMotion(root);
        update({ view: 'search', query: '' });
        update({ view: 'search', query: '旧请求', pager: { loading: true, items: [] } });
        expect(animate).not.toHaveBeenCalled();
        update({ view: 'settings' });
        expect(root.querySelector).toHaveBeenLastCalledWith('.main-panel');
        expect(animate).toHaveBeenCalledTimes(1);
        const state = { view: 'search', query: '新请求', pager: { loading: true, items: [] } };
        update(state);
        expect(animation.cancel).toHaveBeenCalledTimes(1);
        preference.matches = true;
        onChange();
        state.pager = { loading: false, items: [{ id: 'result' }] };
        update(state);
        preference.matches = false;
        onChange();
        update(state);
        expect(animate).toHaveBeenCalledTimes(1);
    } finally {
        media.mockRestore();
    }
});
