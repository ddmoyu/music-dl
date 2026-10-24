// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { parseCookie } from '../app/cookies.js';
vi.mock('@neutralinojs/lib', () => ({ init: vi.fn(), os: {}, storage: {} }));

describe('Cookie input', () => {
    it('accepts Cookie headers, empty values and values containing equals signs', () => {
        expect(parseCookie(' Cookie: session=demo==; empty=; ')).toEqual({
            value: 'session=demo==; empty=',
        });
    });
    it('rejects empty, malformed, multiline and oversized input without echoing it', () => {
        for (const raw of [
            '',
            'not-a-cookie',
            'bad name=demo',
            'a=demo\nAuthorization: secret',
            'a=' + 'x'.repeat(65536),
        ]) {
            const result = parseCookie(raw);
            expect(result.error).toBeTruthy();
            expect(result.value).toBeUndefined();
            if (raw) expect(result.error).not.toContain(raw);
        }
    });
});

it('keeps source cookies isolated, masks drafts and never persists them or adds them to task snapshots', async () => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    await import('../app/main.js');
    let root = document.getElementById('root');
    const click = (selector) => root.querySelector(selector).click();
    const input = (value) => {
        const field = root.querySelector('#cookie-input');
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const submit = () =>
        root
            .querySelector('[data-form="cookie"]')
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const row = (id) => root.querySelector(`[data-key="cookie-${id}"]`).textContent;
    try {
        click('[data-action="settings"]');
        click('[data-action="configure-cookie"][data-id="netease"]');
        const field = root.querySelector('#cookie-input');
        expect(field.type).toBe('password');
        expect(document.activeElement).toBe(field);
        expect(root.querySelector('main').inert).toBe(true);
        input('session=demo_netease');
        field.setSelectionRange(2, 4);
        click('[data-action="reveal-cookie"]');
        expect(field.type).toBe('text');
        expect(field.value).toBe('session=demo_netease');
        expect(root.innerHTML).not.toContain('demo_netease');
        click('[data-action="reveal-cookie"]');
        expect(field.value).toBe('session=demo_netease');
        submit();
        expect(row('netease')).toContain('已填写 · 未验证');
        expect(row('qq')).toContain('未设置');
        expect(root.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement.dataset.id).toBe('netease');
        click('[data-action="configure-cookie"][data-id="qq"]');
        expect(root.querySelector('#cookie-input').value).toBe('');
        input('bad_cookie');
        submit();
        expect(root.querySelector('[role="alert"]').textContent).toContain('格式');
        expect(row('qq')).toContain('未设置');
        input('session=demo_qq');
        submit();
        expect(row('qq')).toContain('已填写 · 未验证');
        click('[data-action="configure-cookie"][data-id="netease"]');
        expect(root.querySelector('#cookie-input').type).toBe('password');
        expect(root.querySelector('#cookie-input').value).toBe('');
        input('session=discard_me');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(row('netease')).toContain('已填写');
        expect(root.innerHTML).not.toContain('discard_me');
        click('[data-action="catalog-mode"][data-id="search"]');
        root.querySelector('#search-input').value = '周杰伦';
        root.querySelector('#search-input').dispatchEvent(new Event('input', { bubbles: true }));
        root.querySelector('[data-form="search"]').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await vi.advanceTimersByTimeAsync(200);
        click('[data-select-all]');
        click('[data-action="download-selected"]');
        click('[data-action="confirm-bulk"]');
        await vi.advanceTimersByTimeAsync(200);
        click('[data-action="close-modal"]');
        vi.advanceTimersByTime(600);
        expect(JSON.parse(localStorage.getItem('shiyin.tasks.v1')).length).toBeGreaterThan(0);
        const persisted = Array.from({ length: localStorage.length }, (_, i) =>
            localStorage.getItem(localStorage.key(i)),
        ).join('');
        expect(persisted).not.toContain('demo_');
        expect(persisted).not.toContain('discard_me');
        click('[data-action="settings"]');
        click('[data-action="configure-cookie"][data-id="netease"]');
        click('[data-action="clear-cookie"]');
        expect(row('netease')).toContain('未设置');
        expect(row('qq')).toContain('已填写');
        vi.clearAllTimers();
        vi.resetModules();
        document.body.innerHTML = '<div id="root"></div>';
        root = document.getElementById('root');
        await import('../app/main.js');
        click('[data-action="settings"]');
        expect(row('qq')).toContain('未设置');
    } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
    }
});
