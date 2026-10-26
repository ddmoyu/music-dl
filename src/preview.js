import { identity, sourceLabel } from './api.js';

const switchRoute = '/assets/switch-source';
const loadTimeout = 15000;

export class Preview {
    constructor(api, change, report) {
        this.api = api;
        this.change = change;
        this.report = report;
        this.generation = 0;
        this.id = '';
        this.title = '';
        this.status = 'idle';
        this.attemptedSources = new Set();
        this.canSwitch = false;
        this.busy = false;
    }
    release() {
        this.generation++;
        this.controller?.abort();
        clearTimeout(this.timer);
        if (this.audio) {
            this.audio.onended = null;
            this.audio.onerror = null;
            this.audio.pause();
            this.audio.removeAttribute('src');
            this.audio.load();
            this.audio = null;
        }
    }
    stop() {
        this.release();
        this.id = '';
        this.title = '';
        this.item = null;
        this.source = '';
        this.status = 'idle';
        this.error = '';
        this.attemptedSources.clear();
        this.canSwitch = false;
        this.busy = false;
        this.change();
    }
    get message() {
        if (!this.item) return '';
        if (this.status === 'loading')
            return `${this.switching ? '正在换源' : '正在加载试听'} · ${this.title}`;
        if (this.status === 'failed') return `试听失败 · ${this.title}：${this.error}`;
        const source = sourceLabel(this.source);
        return `正在试听 · ${this.title} · ${this.source !== this.item.ref.source ? '已切换到 ' : ''}${source}`;
    }
    async play(item, title) {
        if (!item) return;
        const same = this.id === identity(item) && this.status !== 'failed';
        this.stop();
        if (same) return;
        this.item = item;
        this.id = identity(item);
        this.title = title;
        this.source = item.ref.source;
        this.attemptedSources.add(item.ref.source);
        await this.load(false);
    }
    async switchSource() {
        if (!this.item || !this.canSwitch || this.busy) return;
        this.release();
        await this.load(true);
    }
    addSources(sources = []) {
        for (const source of sources)
            if (typeof source === 'string' && source) this.attemptedSources.add(source);
    }
    fail(error, generation) {
        if (generation !== this.generation) return;
        const details = Array.isArray(error.details) ? error.details : [];
        this.addSources(
            details.filter((detail) => detail.field === 'attempted_sources').map((d) => d.reason),
        );
        this.canSwitch =
            error.code !== 'SOURCE_EXHAUSTED' &&
            (this.canSwitch ||
                details.some(
                    (detail) =>
                        detail.field === 'next_action' && detail.reason === `/api/v1${switchRoute}`,
                ));
        this.release();
        this.busy = false;
        this.status = 'failed';
        this.error =
            error.code === 'SOURCE_EXHAUSTED'
                ? '没有可用的匹配音源'
                : error.message || '音源暂不可用';
        this.change();
        this.report(this.message);
    }
    async load(switching) {
        const generation = this.generation;
        this.controller = new AbortController();
        const signal = this.controller.signal;
        this.busy = true;
        this.switching = switching;
        this.status = 'loading';
        this.change();
        try {
            const { data: asset } = await this.api.request(
                switching ? switchRoute : '/assets/resolve',
                {
                    method: 'POST',
                    signal,
                    body: {
                        track: this.item.ref,
                        ...(switching
                            ? { attempted_sources: [...this.attemptedSources] }
                            : { context_ref: this.item.context_ref }),
                        quality: 'standard',
                        quality_policy: 'allow_lower',
                        allow_preview: true,
                    },
                },
            );
            if (generation !== this.generation) return;
            this.addSources(asset.source_retry?.attempted_sources);
            this.source = asset.actual_track?.source || this.item.ref.source;
            this.addSources([this.source]);
            this.canSwitch = true;
            const { data: media } = await this.api.request('/media-access', {
                method: 'POST',
                signal,
                body: {
                    target: { kind: 'asset', id: asset.asset_id },
                    mode: 'auto',
                    auth: 'ticket',
                    ttl_seconds: 60,
                },
            });
            if (generation !== this.generation) return;
            const audio = (this.audio = new Audio(media.url));
            audio.onended = () => {
                if (generation === this.generation) this.stop();
            };
            audio.onerror = () => this.fail(new Error('音源暂不可用，请尝试换源'), generation);
            this.timer = setTimeout(
                () => this.fail(new Error('试听加载超时，请尝试换源'), generation),
                loadTimeout,
            );
            let abort;
            try {
                await new Promise((resolve, reject) => {
                    abort = () => reject(signal.reason);
                    signal.addEventListener('abort', abort, { once: true });
                    Promise.resolve(audio.play()).then(resolve, reject);
                });
            } finally {
                signal.removeEventListener('abort', abort);
            }
            if (generation !== this.generation) return;
            clearTimeout(this.timer);
            this.busy = false;
            this.status = 'playing';
            this.change();
        } catch (error) {
            this.fail(error, generation);
        }
    }
}
