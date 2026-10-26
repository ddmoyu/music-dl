export class ServiceError extends Error {
    constructor(message, code, status, details = []) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
    }
}
export class Api {
    constructor(session, fetcher = (...args) => fetch(...args)) {
        this.session = session;
        this.fetcher = fetcher;
    }
    async request(route, { method = 'GET', body, signal, key, query = {} } = {}) {
        const url = new URL(this.session.api_base_url.replace(/\/$/, '') + '/api/v1' + route);
        for (const [name, value] of Object.entries(query))
            if (value !== undefined && value !== null && value !== '')
                url.searchParams.set(name, value);
        const headers = { Authorization: `Bearer ${this.session.token}` };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (key) headers['Idempotency-Key'] = key;
        const response = await this.fetcher(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: signal
                ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
                : AbortSignal.timeout(45000),
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
        });
        if (response.status === 204) return { data: null };
        const result = await response.json();
        if (!response.ok || result.error)
            throw new ServiceError(
                result.error?.message || `请求失败 (${response.status})`,
                result.error?.code,
                response.status,
                result.error?.details,
            );
        return result;
    }
}
export const sourceLabel = (source) =>
    ({
        kuwo: 'kw',
        netease: 'wyy',
        qq: 'qq',
        kugou: 'kg',
        migu: 'mg',
        fivesing: '5s',
        '5sing': '5s',
        qianqian: 'qqyy',
        joox: 'jx',
        jamendo: 'jm',
        bilibili: 'bl',
    })[source] || source;
// Prefer kw for playback experience; then qq/kg/wyy by MoonFox 2025 MAU
// (https://www.moonfox.cn/insight/news/2003).
// Remaining sources use a fixed product order, not a measured market ranking.
const sourceOrder = ['kw', 'qq', 'kg', 'wyy', 'mg', 'bl', 'qqyy', '5s', 'jx', 'jm'];
export function sortProviders(providers) {
    const rank = (provider) => {
        const index = sourceOrder.indexOf(sourceLabel(provider.source));
        return index < 0 ? sourceOrder.length : index;
    };
    return [...providers].sort((a, b) => rank(a) - rank(b));
}
export const compactText = (value) =>
    String(value ?? '').replace(
        /QQ音乐|QQ 音乐|酷我音乐|酷我|网易云音乐|网易云|酷狗音乐|酷狗|咪咕音乐|咪咕|千千音乐|千千/g,
        (name) =>
            /QQ/.test(name)
                ? 'qq'
                : /酷我/.test(name)
                  ? 'kw'
                  : /网易/.test(name)
                    ? 'wyy'
                    : /酷狗/.test(name)
                      ? 'kg'
                      : /咪咕/.test(name)
                        ? 'mg'
                        : 'qqyy',
    );
export const supports = (provider, capability) =>
    !!(
        provider?.enabled &&
        provider.capabilities?.[capability]?.supported &&
        provider.capabilities[capability].enabled
    );
export const identity = (item) => item.task_id || `${item.ref?.source}:${item.ref?.id}`;
export const terminal = (task) => ['completed', 'failed', 'canceled'].includes(task.status);
export function downloadIntent(track, settings) {
    return {
        track: track.ref,
        ...(track.context_ref ? { context_ref: track.context_ref } : {}),
        quality: settings.quality,
        quality_policy: settings.qualityPolicy,
        allow_preview: false,
        destination_id: settings.destination,
        metadata_policy: 'best_effort',
        duplicate_policy: 'reuse',
    };
}
