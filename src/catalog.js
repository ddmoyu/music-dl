import { supports, sourceLabel } from './api.js';
export function searchPage(api, providers, type, source, query) {
    const sources = providers
        .filter((p) => supports(p, `search_${type}`) && (source === 'all' || p.source === source))
        .map((p) => p.source);
    return async (cursor, signal, progress = () => {}) => {
        const states = cursor
            ? JSON.parse(cursor)
            : Object.fromEntries(sources.map((source) => [source, null]));
        // Unfinished sources keep their current position in every checkpoint.
        const next = { ...states },
            items = [],
            errors = [];
        const entries = Object.entries(states);
        const page = (batch) => ({
            items: batch,
            nextCursor: Object.keys(next).length ? JSON.stringify(next) : null,
            error: errors.join('；'),
        });
        let index = 0;
        // Match the service's default per-principal admission limit.
        const worker = async () => {
            while (index < entries.length) {
                signal.throwIfAborted();
                const [source, position] = entries[index++];
                let batch = [];
                try {
                    const result = await api.request(`/search/${type}`, {
                        query: { q: query, sources: source, limit: 30, cursor: position },
                        signal,
                    });
                    signal.throwIfAborted();
                    const status = result.meta?.source_results?.find(
                        (item) => item.source === source,
                    );
                    if (status && status.status !== 'ok')
                        throw new Error(status.error?.message || '该来源暂不可用');
                    batch = result.data.items || [];
                    items.push(...batch);
                    const sourcePage = status?.page || result.data.page;
                    if (sourcePage?.has_more && sourcePage.next_cursor)
                        next[source] = sourcePage.next_cursor;
                    else delete next[source];
                } catch (error) {
                    if (signal.aborted) throw error;
                    errors.push(`${sourceLabel(source)}: ${error.message}`);
                }
                progress(page(batch));
            }
        };
        await Promise.all(Array.from({ length: Math.min(2, entries.length) }, worker));
        return page(items);
    };
}
export function collectionPage(api, route, query) {
    return async (cursor, signal) => {
        const { data } = await api.request(route, {
            query: route === '/charts' ? query : { ...query, limit: 50, cursor },
            signal,
        });
        return {
            items: Array.isArray(data) ? data : data.items || [],
            nextCursor: data.page?.next_cursor || null,
        };
    };
}
