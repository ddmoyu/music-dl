import { supports } from './api.js';
export function searchPage(api, providers, type, source, query) {
    const sources = providers
        .filter((p) => supports(p, `search_${type}`) && (source === 'all' || p.source === source))
        .map((p) => p.source);
    return async (cursor, signal) => {
        const states = cursor
            ? JSON.parse(cursor)
            : Object.fromEntries(sources.map((source) => [source, null]));
        const next = {},
            items = [],
            errors = [];
        // At most three upstream searches are submitted together.
        const entries = Object.entries(states);
        for (let offset = 0; offset < entries.length; offset += 3) {
            await Promise.all(
                entries.slice(offset, offset + 3).map(async ([source, position]) => {
                    try {
                        const result = await api.request(`/search/${type}`, {
                            query: { q: query, sources: source, limit: 30, cursor: position },
                            signal,
                        });
                        const status = result.meta?.source_results?.find(
                            (item) => item.source === source,
                        );
                        if (status && status.status !== 'ok')
                            throw new Error(status.error?.message || '该来源暂不可用');
                        items.push(...(result.data.items || []));
                        const page = status?.page || result.data.page;
                        if (page?.has_more && page.next_cursor) next[source] = page.next_cursor;
                    } catch (error) {
                        if (signal.aborted) throw error;
                        next[source] = position;
                        errors.push(`${source}: ${error.message}`);
                    }
                }),
            );
        }
        return {
            items,
            nextCursor: Object.keys(next).length ? JSON.stringify(next) : null,
            error: errors.join('；'),
        };
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
