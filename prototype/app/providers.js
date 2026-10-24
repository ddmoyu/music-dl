// Snapshot of the registered music-service capabilities. The production client
// must replace this with GET /providers; these are not universal platform claims.
export const providers = [
    {
        id: 'kuwo',
        name: 'kw',
        short: 'kw',
        types: ['tracks', 'playlists', 'albums', 'artists'],
        artistScope: '完整作品目录',
        artistTracks: true,
        artistAlbums: true,
        qualities: ['standard', 'high', 'lossless', 'hires'],
    },
    {
        id: 'netease',
        name: 'wyy',
        short: 'wyy',
        types: ['tracks', 'playlists', 'albums', 'artists'],
        artistScope: '热门歌曲 · 最多 50 首',
        artistTracks: true,
        artistAlbums: true,
        cookie: true,
        verify: true,
        qualities: ['standard', 'high', 'lossless', 'hires'],
    },
    {
        id: 'qq',
        name: 'qq',
        short: 'qq',
        types: ['tracks', 'playlists', 'albums', 'artists'],
        artistScope: '歌曲与专辑目录',
        artistTracks: true,
        artistAlbums: true,
        cookie: true,
        verify: true,
        searchLogin: true,
        qualities: ['standard', 'high', 'lossless'],
    },
    {
        id: 'kugou',
        name: 'kg',
        short: 'kg',
        types: ['tracks', 'playlists', 'albums', 'artists'],
        artistScope: '完整作品目录',
        artistTracks: true,
        artistAlbums: true,
        qualities: ['standard', 'high', 'lossless'],
    },
    {
        id: 'migu',
        name: 'mg',
        short: 'mg',
        types: ['tracks', 'playlists', 'albums', 'artists'],
        artistScope: '仅支持歌手搜索',
        cookie: true,
        qualities: ['standard', 'high', 'lossless'],
    },
    {
        id: 'fivesing',
        name: '5s',
        short: '5s',
        types: ['tracks', 'playlists'],
        qualities: ['standard', 'high'],
    },
    {
        id: 'qianqian',
        name: 'qqyy',
        short: 'qqyy',
        types: ['tracks', 'albums'],
        qualities: ['standard', 'high', 'lossless'],
    },
    {
        id: 'jamendo',
        name: 'jm',
        short: 'jm',
        types: ['tracks', 'playlists', 'albums', 'artists'],
        artistScope: '歌曲与专辑目录',
        artistTracks: true,
        artistAlbums: true,
        qualities: ['standard'],
    },
    {
        id: 'bilibili',
        name: 'bl',
        short: 'bl',
        types: ['tracks'],
        cookie: true,
        verify: true,
        qualities: ['standard'],
    },
];
export const providerById = new Map(providers.map((p) => [p.id, p]));
export const catalogModes = {
    search: '搜索',
    charts: '排行榜',
    recommendations: '推荐歌单',
};
const chartSources = new Set(['kuwo', 'netease', 'qq', 'kugou', 'migu', 'jamendo']);
const recommendationSources = new Set([...chartSources, 'qianqian']);
export const supportsCatalogMode = (source, mode) =>
    mode === 'search' ||
    (mode === 'charts' && chartSources.has(source)) ||
    (mode === 'recommendations' && recommendationSources.has(source));
// Older saved tasks used display names as their source identifier.
const legacySourceNames = new Map([
    ['酷我音乐', 'kw'],
    ['酷我', 'kw'],
    ['网易云音乐', 'wyy'],
    ['网易云', 'wyy'],
    ['QQ 音乐', 'qq'],
    ['QQ', 'qq'],
    ['酷狗音乐', 'kg'],
    ['酷狗', 'kg'],
    ['咪咕音乐', 'mg'],
    ['咪咕', 'mg'],
    ['5sing', '5s'],
    ['千千音乐', 'qqyy'],
    ['千千', 'qqyy'],
    ['Jamendo', 'jm'],
    ['Bilibili', 'bl'],
    ['B站', 'bl'],
]);
export const sourceName = (id) => providerById.get(id)?.name ?? legacySourceNames.get(id) ?? id;
export const destinations = [
    { id: 'music', name: '音乐文件夹', available: true },
    { id: 'archive', name: '音乐归档', available: true },
    { id: 'offline', name: '移动硬盘', available: false },
];
export const accessStates = {
    available: { label: '可下载', tone: 'good' },
    unknown: { label: '下载时确认', tone: 'muted' },
    login: { label: '需要登录', tone: 'warning' },
    restricted: { label: '暂不可用', tone: 'muted' },
    preview: { label: '仅试听', tone: 'warning' },
};
export const canSelectTrack = (track, settings) =>
    track.access !== 'restricted' &&
    track.access !== 'login' &&
    (track.access !== 'preview' || settings.allowPreview);
