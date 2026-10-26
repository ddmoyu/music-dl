import { afterEach, expect, it, vi } from 'vitest';
import { Accounts, accountStatus, membershipText } from '../../src/accounts.js';
import { trackPay } from '../../src/track-pay.js';

afterEach(() => vi.useRealTimers());
const account = (values = {}) => ({
    credential_id: 'a',
    source: 'kuwo',
    status: 'active',
    enabled: true,
    version: 1,
    login_status: 'unknown',
    verification: { id: 'check-1', state: 'pending' },
    ...values,
});
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

it('polls only pending enabled accounts and stops when verification completes', async () => {
    vi.useFakeTimers();
    const api = {
        request: vi.fn(async (route) => ({
            data:
                route === '/credentials'
                    ? { items: [account()] }
                    : route.startsWith('/credential-defaults/')
                      ? { credential_id: 'a', selection_version: 1 }
                      : account({
                            login_status: 'valid',
                            verification: { id: 'check-1', state: 'complete' },
                        }),
        })),
    };
    const model = new Accounts(api, vi.fn());
    await model.refresh();
    expect(accountStatus(model.items[0])).toBe('校验中');
    await vi.advanceTimersByTimeAsync(1500);
    expect(accountStatus(model.items[0])).toBe('已登录');
    expect(api.request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.request).toHaveBeenCalledTimes(3);
    model.stop();
});

it('ignores a late verification reply after disabling or refreshing an account', async () => {
    vi.useFakeTimers();
    const old = deferred();
    let disabled = false;
    const api = {
        request: vi.fn(async (route) => {
            if (route === '/credentials')
                return {
                    data: {
                        items: [
                            disabled
                                ? account({
                                      enabled: false,
                                      version: 2,
                                      verification: { id: null, state: 'idle' },
                                  })
                                : account(),
                        ],
                    },
                };
            if (route.startsWith('/credential-defaults/'))
                return { data: { credential_id: disabled ? null : 'a' } };
            return old.promise;
        }),
    };
    const model = new Accounts(api, vi.fn());
    await model.refresh();
    await vi.advanceTimersByTimeAsync(1500);
    disabled = true;
    await model.refresh();
    old.resolve({
        data: account({
            login_status: 'valid',
            verification: { id: 'check-1', state: 'complete' },
        }),
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(model.items[0].enabled).toBe(false);
    expect(model.items[0].version).toBe(2);
    expect(accountStatus(model.items[0])).toBe('已停用');
    expect(api.request).toHaveBeenCalledTimes(5);
    model.stop();
});

it('hides revoked records except those that still need secret cleanup', async () => {
    const api = {
        request: vi.fn(async (route) => ({
            data:
                route === '/credentials'
                    ? {
                          items: [
                              account({ credential_id: 'gone', status: 'revoked', enabled: false }),
                              account({
                                  credential_id: 'cleanup',
                                  status: 'revoked',
                                  enabled: false,
                                  secret_cleanup_pending: true,
                              }),
                          ],
                      }
                    : { credential_id: null },
        })),
    };
    const model = new Accounts(api, vi.fn());
    await model.refresh();
    expect(model.items.map((item) => item.credential_id)).toEqual(['cleanup']);
    model.stop();
});

it('keeps unknown membership distinct from none and preserves date-only expiry', () => {
    expect(membershipText({ status: 'unknown' })).toBe('会员未知');
    expect(membershipText({ status: 'none' })).toBe('非会员');
    expect(
        membershipText({
            status: 'active',
            name: '豪华绿钻',
            expiry_precision: 'date',
            expires_on: '2026-10-27',
        }),
    ).toBe('豪华绿钻 · 2026-10-27 到期');
    expect(
        membershipText({ status: 'expired', name: 'VIP', expiry_precision: 'unknown' }),
    ).toContain('已过期');
    expect(accountStatus(account({ verification: { state: 'complete' }, status: 'active' }))).toBe(
        '登录未知',
    );
});

it('retries a transient verification read and clears the old error on recovery', async () => {
    vi.useFakeTimers();
    let failed = false;
    const api = {
        request: vi.fn(async (route) => {
            if (route === '/credentials') return { data: { items: [account()] } };
            if (route.startsWith('/credential-defaults/')) return { data: { credential_id: 'a' } };
            if (!failed) {
                failed = true;
                throw new Error('network');
            }
            return {
                data: account({
                    login_status: 'valid',
                    verification: { id: 'check-1', state: 'complete' },
                }),
            };
        }),
    };
    const model = new Accounts(api, vi.fn());
    await model.refresh();
    await vi.advanceTimersByTimeAsync(1500);
    expect(model.error).toBe('network');
    expect(accountStatus(model.items[0])).toBe('校验中');
    await vi.advanceTimersByTimeAsync(1500);
    expect(model.error).toBe('');
    expect(accountStatus(model.items[0])).toBe('已登录');
    expect(vi.getTimerCount()).toBe(0);
    model.stop();
});

it('bounds refresh retries and allows an explicit refresh to restart recovery', async () => {
    vi.useFakeTimers();
    const api = { request: vi.fn().mockRejectedValue(new Error('offline')) };
    const model = new Accounts(api, vi.fn());
    await model.refresh();
    await vi.runAllTimersAsync();
    expect(api.request).toHaveBeenCalledTimes(6);
    expect(model.error).toBe('offline');
    expect(vi.getTimerCount()).toBe(0);
    await model.refresh();
    expect(vi.getTimerCount()).toBe(1);
    model.stop();
    await vi.runAllTimersAsync();
    expect(api.request).toHaveBeenCalledTimes(7);
});

it('keeps playback and download payment flags independent and does not call unknown free', () => {
    expect(trackPay({ pay_play: 0, pay_down: 1, pay_month: 1 })).toMatchObject({
        badge: 'VIP',
        playHint: '播放无收费标记',
        downloadHint: '下载收费',
    });
    expect(trackPay({ pay_play: 1, pay_down: null, pay_month: null })).toMatchObject({
        badge: '付费',
        downloadHint: '下载收费信息未知',
    });
    expect(trackPay()).toMatchObject({ badge: '', playHint: '播放收费信息未知' });
});
