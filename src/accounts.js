import { compactText } from './api.js';

export function membershipText(membership = {}) {
    if (membership.status === 'none') return '非会员';
    if (!['active', 'expired'].includes(membership.status)) return '会员未知';
    const name = compactText(
        membership.name ||
            { vip: 'VIP', svip: 'SVIP', music_package: '音乐包' }[membership.type] ||
            '会员',
    );
    let expiry = '到期时间未知';
    if (
        membership.expiry_precision === 'date' &&
        /^\d{4}-\d{2}-\d{2}$/.test(membership.expires_on || '')
    )
        expiry = `${membership.expires_on} 到期`;
    if (membership.expiry_precision === 'datetime' && membership.expires_at) {
        const date = new Date(membership.expires_at);
        if (!Number.isNaN(date.getTime()))
            expiry = `${date.toLocaleString('zh-CN', { hour12: false })} 到期`;
    }
    return `${name}${membership.status === 'expired' ? '（已过期）' : ''} · ${expiry}`;
}

export function accountStatus(account) {
    if (account.status === 'revoked') return '已删除';
    if (!account.enabled) return '已停用';
    if (account.verification?.state === 'pending') return '校验中';
    return (
        { valid: '已登录', invalid: '登录失效', unknown: '登录未知' }[account.login_status] ||
        '登录未知'
    );
}

export function verificationHint(code) {
    return (
        {
            SERVICE_BUSY: '校验繁忙，请稍后重试',
            CAPABILITY_UNSUPPORTED: '该平台暂不支持校验',
            CANCELED: '校验已取消',
            INTERRUPTED: '校验已中断',
            STORAGE_UNAVAILABLE: '校验结果保存失败',
            ACCOUNT_DISABLED: '',
            UPSTREAM_TIMEOUT: '校验超时',
            UPSTREAM_FAILED: '平台查询失败',
        }[code] ?? (code ? '暂未取得校验结果，请重试' : '')
    );
}

// One refresh or poll at a time; late replies cannot replace a newer account selection.
export class Accounts {
    constructor(api, change) {
        this.api = api;
        this.change = change;
        this.items = [];
        this.selections = {};
        this.error = '';
        this.generation = 0;
        this.failures = 0;
    }
    stop() {
        this.generation++;
        clearTimeout(this.timer);
        this.controller?.abort();
    }
    async refresh({ retry = false } = {}) {
        this.stop();
        if (!retry) this.failures = 0;
        const generation = this.generation;
        this.controller = new AbortController();
        const signal = this.controller.signal;
        try {
            const { data } = await this.api.request('/credentials', { signal });
            const items = data.items.filter(
                (item) => item.status !== 'revoked' || item.secret_cleanup_pending,
            );
            const selections = {};
            for (const source of new Set(items.map((item) => item.source))) {
                const { data: selected } = await this.api.request(
                    `/credential-defaults/${encodeURIComponent(source)}`,
                    { signal },
                );
                selections[source] = selected;
            }
            if (generation !== this.generation) return;
            this.items = items;
            this.selections = selections;
            this.error = '';
            this.failures = 0;
            this.change();
            this.schedule();
        } catch (error) {
            if (generation !== this.generation) return;
            this.error = error.message;
            this.change();
            this.retry(() => this.refresh({ retry: true }));
        }
    }
    retry(work) {
        clearTimeout(this.timer);
        if (++this.failures <= 5)
            this.timer = setTimeout(
                () => void work(),
                Math.min(30000, 1500 * 2 ** (this.failures - 1)),
            );
    }
    schedule() {
        clearTimeout(this.timer);
        if (this.items.some((item) => item.enabled && item.verification?.state === 'pending'))
            this.timer = setTimeout(() => void this.poll(), 1500);
    }
    async poll() {
        const generation = this.generation;
        const signal = this.controller.signal;
        const pending = this.items.filter(
            (item) => item.enabled && item.verification?.state === 'pending',
        );
        try {
            // Sequential reads avoid flooding the service even with many stored accounts.
            for (const snapshot of pending) {
                const { data } = await this.api.request(
                    `/credentials/${encodeURIComponent(snapshot.credential_id)}`,
                    { signal },
                );
                if (generation !== this.generation) return;
                if (
                    data.version !== snapshot.version ||
                    data.verification?.id !== snapshot.verification.id
                ) {
                    await this.refresh();
                    return;
                }
                this.items = this.items.map((item) =>
                    item.credential_id === data.credential_id ? data : item,
                );
                this.change();
            }
            this.error = '';
            this.failures = 0;
            this.change();
            this.schedule();
        } catch (error) {
            if (generation !== this.generation) return;
            this.error = error.message;
            this.change();
            this.retry(() => this.poll());
        }
    }
}
