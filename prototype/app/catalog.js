import { tracks as seedTracks, collections as seedCollections } from './data.js';
import { providers, providerById, supportsCatalogMode } from './providers.js';

// Local interaction fixtures, not a claim about today's catalog or licenses.
// Large fictional artist catalogs exercise pagination without network services.
const sourceIds = ['kuwo', 'netease', 'qq', 'kugou', 'migu', 'qianqian'];
export const catalogTracks = sourceIds.flatMap((source) =>
    seedTracks
        .filter((t) => t.source !== '5sing')
        .map((track, index) => ({
            ...track,
            id: `${source}:${track.id}`,
            kind: 'track',
            source,
            artistId: `${source}:artist:${track.artist.split(' / ')[0]}`,
            artistName: track.artist.split(' / ')[0],
            access:
                source === 'kuwo'
                    ? 'unknown'
                    : ['unknown', 'available', 'login', 'unknown', 'restricted', 'preview'][
                          index % 6
                      ],
            quality: providerById.get(source).qualities.includes('hires')
                ? track.quality
                : track.quality === 'Hi-Res'
                  ? 'SQ'
                  : track.quality,
        })),
);
catalogTracks.push(
    ...seedTracks
        .filter((t) => t.source === '5sing')
        .map((t) => ({
            ...t,
            id: `fivesing:${t.id}`,
            source: 'fivesing',
            kind: 'track',
            access: 'unknown',
        })),
);
for (const [source, count] of [
    ['kuwo', 1200],
    ['kugou', 420],
    ['netease', 50],
    ['jamendo', 120],
]) {
    for (let i = 0; i < count; i++) {
        catalogTracks.push({
            id: `${source}:forest:${i + 1}`,
            kind: 'track',
            source,
            title: `${['山间来信', '晚风小径', '星河漫游', '雨后森林', '远山回声', '海边日记'][i % 6]} · ${String(i + 1).padStart(3, '0')}`,
            artist: '林间集',
            artistId: `${source}:artist:林间集`,
            album: `山野录 · ${Math.floor(i / 20) + 1}`,
            duration: `0${3 + (i % 3)}:${String(i % 60).padStart(2, '0')}`,
            cover: ['forest', 'sea', 'mountain', 'sky'][i % 4],
            quality: source === 'jamendo' ? 'MP3' : 'SQ',
            access:
                i % 19 === 7
                    ? 'restricted'
                    : i % 23 === 8
                      ? 'login'
                      : i % 31 === 9
                        ? 'preview'
                        : 'unknown',
        });
    }
}
catalogTracks.push({
    id: 'bilibili:BV1Mq4y1U7Lw:cid-demo',
    kind: 'track',
    source: 'bilibili',
    title: '钢琴现场 · 第一 P',
    artist: '',
    album: '',
    duration: '04:12',
    cover: 'mountain',
    quality: 'AAC',
    access: 'unknown',
    part: 1,
});
export const trackById = new Map(catalogTracks.map((item) => [item.id, item]));

export const catalogCollections = sourceIds.flatMap((source) =>
    seedCollections
        .filter((c) =>
            providerById.get(source).types.includes(c.kind === 'album' ? 'albums' : 'playlists'),
        )
        .map((c) => ({
            ...c,
            id: `${source}:collection:${c.id}`,
            source,
            tracks: c.tracks.map((id) => `${source}:${id}`).filter((id) => trackById.has(id)),
        })),
);
catalogCollections.push({
    id: 'kuwo:collection:forest-all',
    kind: 'playlist',
    source: 'kuwo',
    title: '林间集 · 山野全集',
    subtitle: '林间集',
    cover: 'forest',
    tag: '民谣',
    tracks: catalogTracks
        .filter((t) => t.source === 'kuwo' && t.artist === '林间集')
        .map((t) => t.id),
});
const generatedAlbums = new Map();
for (const track of catalogTracks.filter((t) => t.artist === '林间集')) {
    const id = `${track.source}:album:${track.album}`;
    if (!generatedAlbums.has(id))
        generatedAlbums.set(id, {
            id,
            kind: 'album',
            source: track.source,
            title: track.album,
            subtitle: track.artist,
            cover: track.cover,
            tag: '林间集',
            tracks: [],
        });
    generatedAlbums.get(id).tracks.push(track.id);
}
catalogCollections.push(...generatedAlbums.values());
// Fictional discovery fixtures exercise multiple pages, not live platform rankings.
// Keep them out of keyword search; discovery and search are separate capabilities.
export const discoveryCollections = providers.flatMap(({ id: source }) => {
    const pool = catalogTracks.filter((track) => track.source === source);
    return ['charts', 'recommendations'].flatMap((mode) => {
        if (!supportsCatalogMode(source, mode)) return [];
        return Array.from({ length: mode === 'charts' ? 64 : 126 }, (_, index) => {
            const isChart = mode === 'charts';
            const tracks = Array.from(
                { length: Math.min(pool.length, isChart ? 100 : 80) },
                (_, i) => pool[(index * 7 + i) % pool.length].id,
            );
            return {
                id: `${source}:${mode}:${index + 1}`,
                source,
                mode,
                kind: isChart ? 'chart' : 'playlist',
                title: isChart
                    ? `${['流行', '新声', '民谣', '轻音乐'][index % 4]}榜 · ${index + 1}`
                    : `${['午后漫游', '夜色与旋律', '山野来信', '旅途随听'][index % 4]} · ${index + 1}`,
                subtitle: isChart ? '按榜单顺序排列' : '公共歌单',
                cover: ['forest', 'sea', 'sky', 'mountain'][index % 4],
                tag: ['流行', '民谣', '轻音乐', '独立'][index % 4],
                tracks,
            };
        });
    });
});
export const collectionById = new Map(catalogCollections.map((item) => [item.id, item]));
for (const item of discoveryCollections) collectionById.set(item.id, item);
export const tracksForCollection = (item) =>
    item.tracks.map((id) => trackById.get(id)).filter(Boolean);

const artistMap = new Map();
for (const track of catalogTracks) {
    const provider = providerById.get(track.source);
    if (!provider.types.includes('artists') || !track.artistId || artistMap.has(track.artistId))
        continue;
    artistMap.set(track.artistId, {
        id: track.artistId,
        kind: 'artist',
        source: track.source,
        title: track.artistName ?? track.artist,
        cover: track.cover,
    });
}
export const artists = [...artistMap.values()];
export const artistById = artistMap;
const artistTrackMap = new Map();
for (const track of catalogTracks) {
    if (!track.artistId) continue;
    if (!artistTrackMap.has(track.artistId)) artistTrackMap.set(track.artistId, []);
    artistTrackMap.get(track.artistId).push(track);
}
export const tracksForArtist = (id) => artistTrackMap.get(id) ?? [];
export const albumsForArtist = (artist) =>
    catalogCollections.filter(
        (c) =>
            c.source === artist.source &&
            c.kind === 'album' &&
            tracksForCollection(c).some((t) => t.artistId === artist.id),
    );

export function delayedPage(items, cursor, limit, signal, delay = 140) {
    return new Promise((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            const end = Math.min(items.length, cursor + limit);
            resolve({
                items: items.slice(cursor, end),
                total: items.length,
                nextCursor: end < items.length ? end : null,
            });
        }, delay);
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
    });
}

export function prepareCatalog({
    query = '',
    type = 'tracks',
    source = 'all',
    mode = 'search',
    cookies = {},
    artist,
    artistTab = 'tracks',
    collection,
    linkTrack,
}) {
    let items = [];
    let kind = type;
    const notices = [];
    if (collection) {
        items = tracksForCollection(collection);
        kind = 'tracks';
    } else if (linkTrack) {
        items = [linkTrack];
        kind = 'tracks';
    } else if (artist) {
        kind = artistTab;
        items = artistTab === 'albums' ? albumsForArtist(artist) : tracksForArtist(artist.id);
        if (artist.source === 'netease' && artistTab === 'tracks') items = items.slice(0, 50);
    } else if (mode !== 'search') {
        kind = mode === 'charts' ? 'charts' : 'playlists';
        if (supportsCatalogMode(source, mode))
            items = discoveryCollections.filter(
                (item) => item.source === source && item.mode === mode,
            );
    } else if (query.trim()) {
        const selected = providers.filter((p) => source === 'all' || source === p.id);
        const enabled = new Set();
        for (const p of selected) {
            if (!p.types.includes(type)) {
                notices.push({ source: p.id, message: '不支持此类搜索' });
            } else if (p.searchLogin && !cookies[p.id]) {
                notices.push({ source: p.id, message: '搜索需要 Cookie', credential: true });
            } else enabled.add(p.id);
        }
        const pool =
            type === 'tracks'
                ? catalogTracks
                : type === 'artists'
                  ? artists
                  : catalogCollections.filter(
                        (c) => c.kind === (type === 'albums' ? 'album' : 'playlist'),
                    );
        const text = query.trim().toLocaleLowerCase();
        items = pool.filter(
            (item) =>
                enabled.has(item.source) &&
                `${item.title} ${item.artist ?? ''} ${item.album ?? ''} ${item.subtitle ?? ''} ${item.tag ?? ''}`
                    .toLocaleLowerCase()
                    .includes(text),
        );
    }
    return {
        items,
        kind,
        notices,
        fetchPage: (cursor, limit, signal) => delayedPage(items, cursor, limit, signal),
    };
}

// Only reference fixtures are resolved locally. Arbitrary pasted URLs never
// fabricate a successful result or launch a network request.
export const linkExamples = [
    {
        label: '专辑',
        url: 'https://www.kuwo.cn/album_detail/chopin',
        item: 'kuwo:collection:chopin',
    },
    { label: '单曲', url: 'https://www.kuwo.cn/play_detail/228908', item: 'kuwo:track-2' },
    {
        label: '歌单',
        url: 'https://www.kuwo.cn/playlist_detail/2234580349',
        item: 'kuwo:collection:jay',
    },
    {
        label: '长歌单',
        url: 'https://www.kuwo.cn/playlist_detail/forest',
        item: 'kuwo:collection:forest-all',
    },
    {
        label: '视频音轨',
        url: 'https://www.bilibili.com/video/BV1Mq4y1U7Lw/?p=1',
        item: 'bilibili:BV1Mq4y1U7Lw:cid-demo',
    },
];
export function parseLink(text) {
    const match = text.trim().match(/https?:\/\/[^\s<>"，。]+/i);
    if (!match) return { error: '请粘贴完整的歌曲、歌单、专辑或视频链接' };
    try {
        const url = new URL(match[0]);
        if (url.username || url.password) return { error: '链接不能包含账号或密码' };
        const example = linkExamples.find((entry) => {
            const ref = new URL(entry.url);
            return (
                url.hostname === ref.hostname &&
                url.pathname.replace(/\/$/, '') === ref.pathname.replace(/\/$/, '') &&
                (url.searchParams.get('p') ?? '1') === (ref.searchParams.get('p') ?? '1')
            );
        });
        if (!example) return { error: '暂时无法读取这条链接，请检查内容或使用关键词搜索' };
        return { item: trackById.get(example.item) ?? collectionById.get(example.item) };
    } catch {
        return { error: '链接格式不正确，请检查后重试' };
    }
}
