import { icon } from './icons.js';
import { escapeHTML as e } from './dom.js';
import { artwork, qualityNames } from './data.js';
import {
    providers,
    providerById,
    sourceName,
    destinations,
    accessStates,
    canSelectTrack,
    catalogModes,
} from './providers.js';
import { canTaskAction } from './task-actions.js';
import { statuses, isPending, qualityLabel, WORKERS } from './queue.js';
import { cookieProviders } from './cookies.js';
import { virtualWindow, ROW_HEIGHT, TASK_HEIGHT } from './virtual.js';
import { tracksForArtist, albumsForArtist } from './catalog.js';

const checked = (v) => (v ? 'checked' : '');
const disabled = (v) => (v ? 'disabled' : '');
const active = (v) => (v ? 'active' : '');
const action = (name, id = '') => `data-action="${name}" data-id="${e(id)}"`;
const button = (label, name, symbol, id = '', cls = '', off = false) =>
    `<button type="button" class="icon-button ${cls}" aria-label="${e(label)}" title="${e(label)}" ${action(name, id)} ${disabled(off)}>${icon(symbol, 15)}</button>`;
const qualitySelect = (settings, label) =>
    `<select aria-label="${label}" data-setting="quality">${Object.entries(qualityNames)
        .map(
            ([value, name]) =>
                `<option value="${value}" ${settings.quality === value ? 'selected' : ''}>${name}</option>`,
        )
        .join('')}</select>`;
const badge = (label, tone = '') => `<span class="state-badge ${tone}">${e(label)}</span>`;
const sourceBadge = (source) => `<span class="source-badge">${e(sourceName(source))}</span>`;

const listShowsSource = (s) => s.source === 'all' && !s.collection && !s.artist && !s.linkTrack;

function trackRow(track, s, d, index) {
    const access = accessStates[track.access] ?? accessStates.unknown;
    const existing = d.taskByTrack.get(track.id);
    const playable = s.preview?.id === track.id && s.previewPlaying;
    const selectable = canSelectTrack(track, s.settings);
    return `<div role="row" aria-rowindex="${index + 2}" data-key="${e(track.id)}" class="result-grid track-row ${s.selected.has(track.id) ? 'selected' : ''} ${!selectable ? 'restricted-row' : ''}" data-row-index="${index}">
        <div role="cell"><input type="checkbox" aria-label="选择 ${e(track.title)} · ${e(sourceName(track.source))}" data-select="${e(track.id)}" ${checked(s.selected.has(track.id))} ${disabled(!selectable)}></div>
        <div role="cell" class="identity-cell">${s.collection?.kind === 'chart' ? `<span class="chart-rank" aria-label="第 ${index + 1} 名">${index + 1}</span>` : ''}<img src="${e(artwork(track.cover))}" alt="" loading="lazy" decoding="async"><div><button class="title-button" ${action('track-detail', track.id)} title="${e(track.title)}">${e(track.title)}</button><div class="row-subtitle">${track.artistId && providerById.get(track.source)?.types.includes('artists') ? `<button ${action('open-track-artist', track.artistId)}>${e(track.artist)}</button>` : `<span>${e(track.artist || '视频音轨')}</span>`}${listShowsSource(s) ? sourceBadge(track.source) : ''}</div></div></div>
        <div role="cell" class="album-cell"><span class="truncate" title="${e(track.album)}">${e(track.album || '—')}</span><small>${e(track.duration)}</small></div>
        <div role="cell">${badge(track.quality, track.quality === 'Hi-Res' ? 'gold' : '')}</div>
        <div role="cell" class="access-cell">${badge(access.label, access.tone)}</div>
        <div role="cell" class="row-actions">${button(`${playable ? '暂停试听' : '试听'} ${track.title}`, 'preview', playable ? 'Pause' : 'Play', track.id)}${button(existing ? `${track.title} 已加入下载` : `下载 ${track.title}`, 'download-track', existing ? 'Check' : 'ArrowDownToLine', track.id, 'download-action', !selectable || (!!existing && isPending(existing)))}</div>
    </div>`;
}
function collectionRow(item, s, index) {
    return `<div role="row" aria-rowindex="${index + 2}" data-key="${e(item.id)}" class="result-grid collection-grid collection-row ${s.selected.has(item.id) ? 'selected' : ''}" data-row-index="${index}">
        <div role="cell"><input type="checkbox" aria-label="选择 ${e(item.title)}" data-select="${e(item.id)}" ${checked(s.selected.has(item.id))}></div>
        <div role="cell" class="identity-cell"><img src="${e(artwork(item.cover))}" alt="" loading="lazy"><div><button class="title-button collection-name" ${action('collection', item.id)}>${e(item.title)}</button>${!item.mode || listShowsSource(s) ? `<div class="row-subtitle">${!item.mode ? `<span>${e(item.subtitle)}</span>` : ''}${listShowsSource(s) ? sourceBadge(item.source) : ''}</div>` : ''}</div></div>
        <div role="cell" class="album-cell">${e(item.tag)}</div><div role="cell">${item.tracks.length} 首</div>
        <div role="cell" class="row-actions">${button(`下载 ${item.title}`, 'download-collection', 'Download', item.id, 'download-action')}</div>
    </div>`;
}
function artistRow(item, index, s) {
    const p = providerById.get(item.source);
    return `<div role="row" aria-rowindex="${index + 2}" data-key="${e(item.id)}" class="artist-grid artist-row ${listShowsSource(s) ? '' : 'single-source'}" data-row-index="${index}">
        <div role="cell" class="identity-cell"><span class="artist-avatar">${e(item.title.slice(0, 1))}</span><div><button class="title-button" ${action('artist', item.id)}>${e(item.title)}</button><small class="row-subtitle">${p.artistTracks ? `${tracksForArtist(item.id).length} 首${item.source === 'netease' ? '热门歌曲' : '目录歌曲'} · ${albumsForArtist(item).length} 张专辑` : '可按歌手名搜索歌曲'}</small></div></div>
        <div role="cell" class="artist-source">${sourceBadge(item.source)}</div><div role="cell" class="artist-scope">${badge(p.artistScope, p.artistTracks ? '' : 'muted')}</div>
        <div role="cell" class="row-actions"><button class="text-button green" ${action('artist', item.id)}>${p.artistTracks ? '查看作品' : '搜索歌曲'}${icon('ChevronRight', 13)}</button></div>
    </div>`;
}
function taskControls(task, s) {
    return `<div class="task-controls">${['failed', 'canceled'].includes(task.status) ? button(`重试 ${task.track.title}`, 'retry', 'RotateCcw', task.id) : isPending(task) ? button(`取消 ${task.track.title}`, 'cancel', 'X', task.id, '', ['finalizing', 'canceling'].includes(task.status)) : ''}<button class="icon-button" aria-label="${e(`更多操作 ${task.track.title}`)}" title="更多操作" aria-haspopup="menu" aria-expanded="${s.taskMenu?.anchor === task.id}" ${action('task-menu', task.id)}>${icon('MoreHorizontal')}</button></div>`;
}
function taskRow(task, s) {
    return `<div data-key="${e(task.id)}" class="download-row ${task.status} ${s.taskSelected.has(task.id) ? 'selected' : ''}" data-task-row="${e(task.id)}"><input type="checkbox" data-task-select="${e(task.id)}" aria-label="选择任务 ${e(task.track.title)}" ${checked(s.taskSelected.has(task.id))}><img src="${e(artwork(task.track.cover))}" alt="" loading="lazy"><div class="task-song"><button class="title-button" ${action('task-detail', task.id)}>${e(task.track.title)}</button><span>${e(sourceName(task.track.source))} · ${e(['queued', 'resolving'].includes(task.status) ? `请求 ${qualityLabel(task.requestedQuality ?? task.quality)}` : qualityLabel(task.quality))} · ${task.totalMB.toFixed(1)} MB</span>${task.error ? `<p class="task-error">${e(task.error)}</p>` : task.warnings?.length ? `<p class="task-warning">${e(task.warnings.join(' · '))}</p>` : ''}</div><div class="task-progress"><div><span>${statuses[task.status]}</span><span class="numeric">${task.status === 'downloading' ? `${task.speed.toFixed(1)} MB/s` : `${Math.floor(task.progress)}%`}</span></div><div class="progress-track" role="progressbar" aria-label="${e(task.track.title)} 下载进度" aria-valuenow="${Math.floor(task.progress)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${task.progress}%"></span></div></div>${taskControls(task, s)}</div>`;
}
export function listHTML(s, d) {
    const tasks = s.view === 'downloads';
    const items = tasks ? d.visibleTasks : s.pager.items;
    const window = virtualWindow(
        items.length,
        s.viewport.top,
        s.viewport.height,
        tasks ? TASK_HEIGHT : ROW_HEIGHT,
    );
    const rows = items
        .slice(window.start, window.end)
        .map((item, i) =>
            tasks
                ? taskRow(item, s)
                : d.kind === 'artists'
                  ? artistRow(item, window.start + i, s)
                  : d.kind === 'tracks'
                    ? trackRow(item, s, d, window.start + i)
                    : collectionRow(item, s, window.start + i),
        )
        .join('');
    return `<div aria-hidden="true" data-key="spacer-before" style="height:${window.before}px"></div>${rows}<div aria-hidden="true" data-key="spacer-after" style="height:${window.after}px"></div>`;
}
function loadStatus(s) {
    return `<div class="load-status" data-key="load-status" aria-live="polite">${s.pager.loading ? `${icon('LoaderCircle', 13, 'spin')}正在加载…` : s.pager.error ? `<span>${e(s.pager.error)}</span><button class="text-button green" ${action('load-more')}>重试</button>` : s.pager.hasMore ? `<button class="text-button" ${action('load-more')}>继续滚动加载 · 已加载 ${s.pager.items.length} / ${s.pager.total}</button>` : s.pager.items.length ? `已显示全部 ${s.pager.items.length} 项` : ''}</div>`;
}
function searchPage(s, d) {
    const names = { tracks: '单曲', playlists: '歌单', albums: '专辑', artists: '歌手' };
    const browsing = s.catalogMode !== 'search';
    const context =
        s.collection ??
        s.artist ??
        s.linkTrack ??
        (d.canGoBack ? { title: `「${s.query}」`, source: s.source } : null);
    const selected = s.selected.size;
    const sourceControl = `<select class="source-select" aria-label="音乐来源" id="source" data-key="source"><option value="all" ${s.source === 'all' ? 'selected' : ''}>全部来源</option>${providers.map((p) => `<option value="${p.id}" ${s.source === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}</select>`;
    return `${!browsing ? `<section class="search-panel" data-key="search-panel"><div class="catalog-navigation">${sourceControl}</div>` : ''}${
        !browsing
            ? `<div class="search-mode-row"><div class="search-types" role="group" aria-label="搜索类型" data-active="${s.searchType}">${Object.entries(
                  names,
              )
                  .map(
                      ([id, label]) =>
                          `<button data-key="type-${id}" ${disabled(s.source !== 'all' && !providerById.get(s.source)?.types.includes(id))} title="${s.source !== 'all' && !providerById.get(s.source)?.types.includes(id) ? '当前平台不支持此类搜索' : label}" class="${active(s.searchType === id)}" aria-pressed="${s.searchType === id}" ${action('search-type', id)}>${icon(id === 'albums' ? 'Disc3' : id === 'artists' ? 'UserRound' : id === 'playlists' ? 'ListMusic' : 'Music2', 14)}${label}</button>`,
                  )
                  .join('')}</div></div>
    <form class="search-form" data-form="search"><div class="search-input">${icon('Search', 18)}<input id="search-input" value="${e(s.search)}" placeholder="搜索${names[s.searchType]}${s.searchType === 'tracks' ? '名、歌手名' : '名称'}，或粘贴链接" aria-label="搜索音乐" maxlength="4096">${s.search ? button('清空搜索', 'clear-search', 'X') : '<kbd>Ctrl K</kbd>'}</div><button class="button primary search-submit" type="submit">搜索</button></form>`
            : ''
    }${!browsing ? '</section>' : ''}
    ${s.notices.length ? `<div class="source-notices" data-key="notices"><span>${s.notices.some((n) => n.credential) ? '部分来源未参与搜索' : '已按来源能力筛选'}</span><details><summary>查看 ${s.notices.length} 个来源</summary><div>${s.notices.map((n) => `<p>${e(sourceName(n.source))} · ${e(n.message)} ${n.credential ? `<button class="text-button green" ${action('configure-cookie', n.source)}>设置 Cookie</button>` : ''}</p>`).join('')}</div></details></div>` : ''}
    <div class="results-heading" data-key="results-heading">${context ? `<div class="collection-breadcrumb"><button ${action('back')}>${icon('ArrowLeft', 14)}返回</button><strong>${e(context.title)}</strong>${context.source !== s.source ? sourceBadge(context.source) : ''}</div>` : `<span>${browsing ? `<strong>${catalogModes[s.catalogMode]}</strong><span class="result-count">${s.pager.total} 项</span>` : s.query ? `「<strong>${e(s.query)}</strong>」<span class="result-count">${s.pager.total} 项</span>` : '搜索结果'}</span>`}<div class="results-actions">${(s.collection || (s.artist && s.artistTab === 'tracks')) && s.pager.items.length ? `<button class="text-button green" ${action('download-all')}>${icon('Download', 13)}下载整个列表</button>` : ''}${browsing ? sourceControl : ''}</div></div>
    ${s.artist ? `<div class="artist-context" data-key="artist-context"><div class="context-tabs"><button class="${active(s.artistTab === 'tracks')}" ${action('artist-tab', 'tracks')}>${s.artist.source === 'netease' ? '热门歌曲' : '歌曲'}</button><button class="${active(s.artistTab === 'albums')}" ${action('artist-tab', 'albums')}>专辑</button></div><span>${e(providerById.get(s.artist.source).artistScope)} · 下载权限以单曲为准</span></div>` : d.kind === 'artists' && s.query ? '<p class="catalog-note" data-key="artist-note">按平台展示歌手及作品范围；同名结果独立保留，下载权限以单曲为准。</p>' : ''}
    ${s.pager.items.length ? `<section class="result-table" role="table" aria-label="${d.kind === 'charts' ? '排行榜' : names[d.kind]}结果" aria-rowcount="${s.pager.total + 1}" data-key="result-table"><div role="row" class="list-head ${d.kind === 'artists' ? `artist-grid ${listShowsSource(s) ? '' : 'single-source'}` : d.kind === 'tracks' ? 'result-grid' : 'result-grid collection-grid'}">${d.kind === 'artists' ? '<span role="columnheader">歌手</span><span role="columnheader" class="artist-source">来源</span><span role="columnheader">作品范围</span><span role="columnheader">操作</span>' : `<span role="columnheader"><input type="checkbox" aria-label="选择已加载结果" title="选择已加载结果" data-select-all ${checked(d.allSelected)} ${disabled(!d.selectable.length)}></span><span role="columnheader">${d.kind === 'tracks' ? '歌曲 / 歌手' : '名称'}${listShowsSource(s) ? ' / 来源' : ''}</span><span role="columnheader" class="album-cell">${d.kind === 'tracks' ? '专辑 / 时长' : '风格'}</span><span role="columnheader">${d.kind === 'tracks' ? '音质' : '曲目'}</span>${d.kind === 'tracks' ? '<span role="columnheader" class="access-cell">资源状态</span>' : ''}<span role="columnheader">操作</span>`}</div><div class="results-scroll virtual-scroll" tabindex="0" aria-label="滚动浏览结果" data-key="results"><div class="virtual-content" role="rowgroup">${listHTML(s, d)}</div>${loadStatus(s)}</div></section>` : `<div class="empty-results" data-key="empty-search"><div class="empty-search-mark">${icon(s.pager.loading ? 'LoaderCircle' : 'Search', 28, s.pager.loading ? 'spin' : '')}</div><h2>${s.pager.loading ? '正在加载…' : browsing ? '暂无内容' : s.query || context ? '没有找到相关结果' : '想下载什么音乐？'}</h2><p>${browsing ? '可以切换其他平台浏览。' : s.query || context ? '试试其他关键词，或切换音乐来源。' : '搜索单曲、歌单、专辑或歌手，也可以粘贴分享链接。'}</p>${s.pager.error ? `<p role="alert">${e(s.pager.error)}</p><button class="text-button" ${action('load-more')}>重试</button>` : ''}${!browsing && !s.query ? `<div class="search-history"><span>${s.history.length ? '最近搜索' : '试着搜索'}</span>${(s.history.length ? s.history : ['周杰伦', '林间集', '晴天']).map((item) => `<button ${action('history', item)}>${e(item)}</button>`).join('')}${s.history.length ? button('清空搜索历史', 'clear-history', 'Trash2') : ''}</div>` : ''}</div>`}
    ${d.kind !== 'artists' && s.pager.items.length ? `<div class="batch-toolbar" data-key="batch"><span class="selection-count">已选 <b>${selected}</b> 项</span>${selected ? `<button class="text-button" ${action('clear-selected')}>清空</button>` : ''}<div class="batch-right">${qualitySelect(s.settings, '下载音质')}<button class="button primary" ${action('download-selected')} ${disabled(!selected || !!s.bulk?.running)}>${icon('Download')}下载所选</button></div></div>` : ''}`;
}
function downloadsPage(s, d) {
    return `<div class="downloads-page"><div class="downloads-heading"><div class="task-tabs">${[
        ['进行中', d.active.length],
        ['已完成', d.completed.length],
        ['失败', d.failed.length],
        ['已取消', d.canceled.length],
    ]
        .map(
            ([name, count]) =>
                `<button class="${active(s.downloadTab === name)}" ${action('download-tab', name)}>${name}<span>${count}</span></button>`,
        )
        .join(
            '',
        )}</div><button class="text-button" title="仅控制新任务开始，正在执行的任务会继续" ${action('toggle-admission')}>${icon(s.admissionPaused ? 'Play' : 'Pause', 13)}${s.admissionPaused ? '允许新任务开始' : '暂停开始新任务'}</button></div><div class="task-filter"><select id="batch-filter" aria-label="筛选下载批次"><option value="all">全部批次</option>${d.batches.map((batch, i) => `<option value="${e(batch.id)}" ${s.batchFilter === batch.id ? 'selected' : ''}>批次 ${i + 1} · ${batch.count} 项</option>`).join('')}</select><span>${s.admissionPaused ? '新任务等待中，正在执行的任务会继续' : `同时下载最多 ${WORKERS} 首`}</span>${s.batchFilter !== 'all' && d.active.some((t) => t.batchId === s.batchFilter && canTaskAction(t, 'cancel')) ? `<button class="text-button" ${action('cancel-batch', s.batchFilter)}>取消此批次</button>` : ''}</div>
    ${d.visibleTasks.length ? `<div class="task-list virtual-scroll" tabindex="0" aria-label="滚动浏览下载任务" data-key="task-list"><div class="virtual-content">${listHTML(s, d)}</div></div>` : `<div class="empty-results"><div class="empty-search-mark">${icon('Download', 28)}</div><h2>暂无${s.downloadTab}任务</h2><button class="text-button green" ${action('catalog-mode', 'search')}>搜索音乐${icon('ArrowRight', 13)}</button></div>`}${d.visibleTasks.length ? taskToolbar(s, d) : ''}</div>`;
}

function taskToolbar(s, d) {
    const selected = d.visibleTasks.filter((t) => s.taskSelected.has(t.id));
    const control = (label, id, symbol) => {
        const count = selected.filter((t) => canTaskAction(t, id)).length;
        return `<button class="button secondary" ${action('task-bulk-action', id)} ${disabled(!count || s.taskBusy)} title="${id === 'delete' ? '仅删除已结束的任务记录，保留音乐文件' : label}">${icon(symbol, 14)}${label}</button>`;
    };
    return `<div class="task-selection-bar" data-key="task-selection"><div class="task-selection-summary"><label><input type="checkbox" data-task-select-all aria-label="选择当前列表的全部任务" ${checked(selected.length === d.visibleTasks.length)}>全选</label><span>已选 <b>${selected.length}</b> 项</span>${selected.length ? `<button class="text-button" ${action('task-clear-selection')}>清空</button>` : ''}</div><div class="task-bulk-controls">${s.downloadTab === '进行中' ? control('取消所选', 'cancel', 'X') : `${s.downloadTab === '已完成' ? '' : control('重试所选', 'retry', 'RotateCcw')}${control('删除记录', 'delete', 'Trash2')}`}${s.taskBusy ? '<span role="status">处理中…</span>' : ''}</div></div>`;
}
function taskMenuHTML(s) {
    if (!s.taskMenu) return '';
    const tasks = s.tasks.filter((t) => s.taskMenu.ids.includes(t.id));
    const entry = (label, id, symbol) => {
        const count = tasks.filter((t) => canTaskAction(t, id)).length;
        const hint =
            id === 'delete'
                ? '仅删除已结束的记录；运行中的任务请先取消'
                : id === 'cancel'
                  ? '保存文件或取消中的任务无法再次取消'
                  : id === 'retry'
                    ? '仅重试失败或已取消的任务'
                    : '按当前下载偏好创建新任务';
        return `<button role="menuitem" ${action('task-menu-action', id)} ${disabled(!count || s.taskBusy)} title="${hint}">${icon(symbol, 14)}${label}${tasks.length > 1 && count ? `<small>${count}</small>` : ''}</button>`;
    };
    return `<div class="task-context-menu" data-key="task-menu" role="menu" aria-label="任务操作" style="left:${s.taskMenu.x}px;top:${s.taskMenu.y}px"><div class="task-menu-caption">${tasks.length > 1 ? `已选 ${tasks.length} 项` : e(tasks[0]?.track.title ?? '任务操作')}</div>${tasks.length === 1 ? `<button role="menuitem" ${action('task-detail', tasks[0].id)}>${icon('ListMusic', 14)}查看详情</button>` : ''}${s.taskMenu.actions.includes('cancel') ? entry('取消任务', 'cancel', 'X') : ''}${s.taskMenu.actions.includes('retry') ? entry('按原设置重试', 'retry', 'RotateCcw') : ''}${s.taskMenu.actions.includes('redownload') ? entry('按当前偏好重新下载', 'redownload', 'Download') : ''}<div role="separator"></div>${entry('删除记录', 'delete', 'Trash2')}</div>`;
}

function settingsPage(s) {
    const row = (title, hint, control) =>
        `<div class="setting-row"><div><h3>${title}</h3><p>${hint}</p></div>${control}</div>`;
    const toggle = (key, title) =>
        `<button class="toggle ${s.settings[key] ? 'on' : ''}" role="switch" aria-label="${title}" aria-checked="${s.settings[key]}" ${action('toggle-setting', key)}><span></span></button>`;
    return `<div class="settings-page"><div class="settings-heading"><h1>下载设置</h1><span>${icon('Check', 13)}偏好自动保存</span></div>
    <section class="settings-section"><h2>${icon('AudioLines')}音质与下载</h2>${row('默认音质', '根据来源能力选择；下载结果显示实际音质', qualitySelect(s.settings, '默认下载音质'))}${row('允许降低音质', '所选音质不可用时尝试较低音质', toggle('allowLower', '允许降低音质'))}${row('允许保存试听片段', '默认关闭，避免把片段当作整首歌曲', toggle('allowPreview', '允许保存试听片段'))}${row('复用已下载结果', '相同下载要求优先复用已有文件', toggle('skipDuplicates', '复用已下载结果'))}</section>
    <section class="settings-section"><h2>${icon('Folder')}文件保存</h2>${row('下载目标', '选择服务授权的保存位置', `<select aria-label="下载目标" data-setting="destination">${destinations.map((d) => `<option value="${d.id}" ${s.settings.destination === d.id ? 'selected' : ''} ${disabled(!d.available)}>${d.name}${d.available ? '' : ' · 不可用'}</option>`).join('')}</select>`)}${row(
        '歌曲信息处理',
        '标签、封面或歌词缺失时如何处理',
        `<select aria-label="歌曲信息处理" data-setting="metadataPolicy">${[
            ['best_effort', '尽量写入'],
            ['required', '信息缺失则失败'],
            ['skip', '跳过元数据'],
        ]
            .map(
                ([id, title]) =>
                    `<option value="${id}" ${s.settings.metadataPolicy === id ? 'selected' : ''}>${title}</option>`,
            )
            .join('')}</select>`,
    )}<p class="settings-note">目录整理、命名及独立歌词／封面导出使用服务端配置。完成后可在任务详情查看产物。</p></section>
    <section class="settings-section cookie-settings"><h2>${icon('UserRound')}来源凭证<span class="section-caption">Cookie</span></h2>${cookieProviders.map((p) => row(p.name, `${s.cookies[p.id] ? '已填写 · 未验证' : '未设置 Cookie'}${p.verify ? '' : ' · 不支持有效性校验'}`, `<div class="credential-actions"><button class="button secondary" aria-label="设置 ${p.name} Cookie" ${action('configure-cookie', p.id)}>${s.cookies[p.id] ? '更新' : '设置'}${icon('ChevronRight', 12)}</button></div>`).replace('class="setting-row"', `class="setting-row cookie-provider" data-key="cookie-${p.id}"`)).join('')}</section>
    <section class="settings-section"><h2>${icon('SlidersHorizontal')}服务连接${badge('未连接', 'muted')}</h2><form class="service-form" data-form="service"><label for="service-url">服务地址</label><input id="service-url" value="${e(s.serviceDraft)}" type="url" placeholder="http://127.0.0.1:17632" required><label for="service-token">访问凭证</label><input id="service-token" data-private type="password" autocomplete="off" placeholder="仅本次打开期间保留"><p class="settings-note">访问凭证与音乐平台 Cookie 分开保存。</p>${s.serviceError ? `<p role="alert" class="cookie-error">${e(s.serviceError)}</p>` : ''}<button class="button secondary" type="submit">保存连接设置</button></form></section><button class="text-button reset-settings" ${action('reset-settings')}>恢复下载偏好</button></div>`;
}
function modal(title, content, cls = '') {
    return `<div class="modal-backdrop" data-key="modal"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="modal-heading"><h2 id="dialog-title">${e(title)}</h2>${button('关闭对话框', 'close-modal', 'X')}</div>${content}</section></div>`;
}
function dialogHTML(s) {
    if (s.taskDelete)
        return modal(
            '删除任务记录',
            `<p class="dialog-copy">删除所选的 ${s.taskDelete.length} 条任务记录？</p><p class="dialog-copy muted">仅清理已结束的任务记录，已下载的音乐文件会保留。</p><div class="modal-actions"><button class="button secondary" ${action('close-modal')}>保留</button><button class="button primary" ${action('confirm-task-delete')}>删除记录</button></div>`,
        );
    if (s.cookieDialog) {
        const p = s.cookieDialog;
        return modal(
            `${p.name} Cookie`,
            `<form data-form="cookie"><p class="cookie-description">${s.cookies[p.id] ? '已填写，尚未验证。保存新的 Cookie 会替换当前内容。' : '填写自己的登录 Cookie；填写不代表验证成功或拥有下载权限。'}</p><label for="cookie-input">Cookie 内容</label><div class="cookie-input-field"><input id="cookie-input" data-private type="${s.cookieVisible ? 'text' : 'password'}" autocomplete="off" spellcheck="false" maxlength="65536" placeholder="name=value; name2=value2" aria-invalid="${!!s.cookieError}"><button type="button" ${action('reveal-cookie')}>${s.cookieVisible ? '隐藏' : '显示'}</button></div>${s.cookieError ? `<p class="cookie-error" role="alert">${e(s.cookieError)}</p>` : ''}<p class="cookie-note">仅本次打开期间保留，不写入本地文件。</p><details class="cookie-help"><summary>如何获取 Cookie</summary><ol><li>在浏览器中登录 ${p.name}。</li><li>打开开发者工具的 Network 面板，刷新页面。</li><li>复制请求标头 Cookie 的值并粘贴。</li></ol></details><div class="modal-actions"><button type="button" class="text-button cookie-clear" ${action('clear-cookie')} ${disabled(!s.cookies[p.id])}>清除 Cookie</button><button type="button" class="button secondary" ${action('close-modal')}>取消</button><button class="button primary" type="submit" ${disabled(!s.cookieDraft.trim())}>保存</button></div></form>`,
            'cookie-modal',
        );
    }
    if (s.linkDialog)
        return modal(
            '从链接添加',
            `<form data-form="link"><label for="link-input">歌曲、歌单、专辑或视频分享链接</label><input id="link-input" value="${e(s.linkDraft)}" maxlength="4096" placeholder="https://…" autocomplete="off">${s.linkError ? `<p class="cookie-error" role="alert">${e(s.linkError)}</p>` : ''}${s.linkResult ? `<div class="link-result"><img src="${e(artwork(s.linkResult.cover))}" alt=""><div><strong>${e(s.linkResult.title)}</strong><p>${e(sourceName(s.linkResult.source))} · ${s.linkResult.kind === 'track' ? '单曲 / 音轨' : `${s.linkResult.tracks.length} 首歌曲`}</p></div></div>` : ''}<div class="modal-actions"><button type="button" class="button secondary" ${action('close-modal')}>取消</button>${!s.linkResult ? '<button class="button primary" type="submit">解析链接</button>' : ''}${s.linkResult ? `<button type="button" class="button primary" ${action('open-link-result')}>查看内容</button>` : ''}</div></form>`,
        );
    if (s.bulk) {
        const b = s.bulk;
        return modal(
            '批量加入下载',
            `<p class="dialog-copy">${e(b.title)} · ${b.total} 首</p><p class="dialog-copy muted">分批加入，每批最多 100 首。不可用或需要登录的歌曲会跳过。</p>${b.running || b.done ? `<div class="bulk-progress" role="status"><strong>已处理 ${b.processed} / ${b.total}</strong><div class="progress-track"><span style="width:${b.total ? (b.processed / b.total) * 100 : 0}%"></span></div><p>加入 ${b.added} · 重复 ${b.skipped} · 不可用 ${b.unavailable} · 队列已满 ${b.capacity}</p></div>` : ''}${b.capacity ? '<p class="cookie-error">未加入的歌曲不会自动提交，请等待队列空闲后重试。</p>' : ''}<div class="modal-actions">${b.running ? `<button class="button secondary" ${action('stop-bulk')}>停止加入</button>` : b.done ? `<button class="button secondary" ${action('close-modal')}>关闭</button><button class="button primary" ${action('bulk-tasks')}>查看任务</button>` : `<button class="button secondary" ${action('close-modal')}>取消</button><button class="button primary" ${action('confirm-bulk')}>开始加入</button>`}</div>`,
        );
    }
    if (s.trackDetail) {
        const t = s.trackDetail;
        return modal(
            t.title,
            `<div class="detail-cover"><img src="${e(artwork(t.cover))}" alt=""><div><p>${e(t.artist || '视频音轨')}</p><p>${e(t.album || '—')}</p>${t.source !== s.source ? sourceBadge(t.source) : ''}</div></div><dl class="detail-grid"><dt>时长</dt><dd>${e(t.duration)}</dd><dt>音质提示</dt><dd>${e(t.quality)}</dd><dt>资源状态</dt><dd>${badge((accessStates[t.access] ?? accessStates.unknown).label)}</dd></dl><p class="dialog-copy muted">音质提示不代表当前账号一定可下载；实际权限与音质在解析时确认。</p><div class="modal-actions"><button class="button secondary" ${action('preview', t.id)}>试听</button><button class="button primary" ${action('download-track', t.id)} ${disabled(!canSelectTrack(t, s.settings))}>加入下载</button></div>`,
        );
    }
    if (s.taskDetail) {
        const t = s.tasks.find((item) => item.id === s.taskDetail);
        if (!t) return '';
        return modal(
            '任务详情',
            `<div class="detail-cover"><img src="${e(artwork(t.track.cover))}" alt=""><div><strong>${e(t.track.title)}</strong><p>${e(t.track.artist)} · ${e(sourceName(t.track.source))}</p>${badge(statuses[t.status])}</div></div><dl class="detail-grid"><dt>请求音质</dt><dd>${e(qualityLabel(t.requestedQuality ?? t.quality))}</dd><dt>实际音质</dt><dd>${['queued', 'resolving'].includes(t.status) ? '待确认' : e(qualityLabel(t.quality))}</dd><dt>下载目标</dt><dd>${e(destinations.find((d) => d.id === t.options.destination)?.name ?? '音乐文件夹')}</dd><dt>任务编号</dt><dd class="task-id">${e(t.id)}</dd>${t.retryOf ? `<dt>重试自</dt><dd class="task-id">${e(t.retryOf)}</dd>` : ''}</dl>${t.error ? `<p class="cookie-error">${e(t.error)} <small>${e(t.errorCode)}</small></p>` : ''}${t.warnings?.map((w) => `<p class="task-warning">${e(w)}</p>`).join('') ?? ''}${t.status === 'completed' ? `<div class="artifact-summary"><h3>下载结果</h3><p>${e(t.track.title)} · ${t.track.source === 'bilibili' ? 'M4A' : ['lossless', 'hires'].includes(t.quality) ? 'FLAC' : 'MP3'} · ${t.totalMB.toFixed(1)} MB</p><p>歌曲信息：${t.options.metadataPolicy === 'skip' ? '已跳过' : '已处理'} · 独立歌词／封面：未导出</p></div>` : ''}<div class="modal-actions">${['failed', 'canceled'].includes(t.status) ? `<button class="button secondary" ${action('retry', t.id)}>按原设置重试</button><button class="button primary" ${action('redownload', t.id)}>按当前偏好重新下载</button>` : `<button class="button secondary" ${action('close-modal')}>关闭</button>`}</div>`,
        );
    }
    return '';
}
export function appHTML(s, d) {
    return `<div class="app-window"><header class="app-header" data-key="header"><div class="brand"><span class="brand-mark">${icon('AudioLines', 19)}</span><strong>拾音</strong><span class="brand-description">音乐下载工具</span></div><nav class="main-nav" aria-label="主导航">${['charts', 'recommendations', 'search'].map((id) => `<button data-key="mode-${id}" class="${active(s.view === 'search' && s.catalogMode === id)}" aria-pressed="${s.view === 'search' && s.catalogMode === id}" ${action('catalog-mode', id)}>${id === 'search' ? icon('Search', 14) : ''}${id === 'search' ? '搜索音乐' : catalogModes[id]}</button>`).join('')}<button class="${active(s.view === 'downloads')}" ${action('view', 'downloads')}>${icon('Download', 14)}下载任务${d.active.length ? `<span>${d.active.length}</span>` : ''}</button></nav><div class="header-settings">${button('下载设置', 'settings', 'Settings2', '', active(s.view === 'settings'))}</div></header>
    <main class="main-panel ${s.view}" data-key="${s.view}">${s.view === 'search' ? searchPage(s, d) : s.view === 'downloads' ? downloadsPage(s, d) : settingsPage(s)}</main>
    ${s.preview ? `<div class="preview-strip" data-key="preview">${icon('AudioLines')}<strong>${e(s.preview.title)}</strong><span>试听 · ${Math.floor(s.previewSeconds)} / 30 秒</span><div class="preview-progress"><span style="width:${(s.previewSeconds / 30) * 100}%"></span></div>${button(s.previewPlaying ? '暂停试听' : '继续试听', 'preview', s.previewPlaying ? 'Pause' : 'Play', s.preview.id)}${button('关闭试听', 'stop-preview', 'X')}</div>` : ''}
    ${
        s.view !== 'downloads'
            ? `<section class="queue-drawer" data-key="drawer" data-expanded="${!!(s.queueExpanded && d.active.length)}" aria-hidden="${!(s.queueExpanded && d.active.length)}"><div class="queue-drawer-content"><div class="drawer-heading"><span>下载队列 <b>${d.active.length}</b></span><div><button class="text-button" ${action('view', 'downloads')}>全部任务${icon('ChevronRight', 12)}</button>${button('收起下载队列', 'collapse-queue', 'ChevronDown')}</div></div><div class="compact-queue">${d.active
                  .slice(0, 3)
                  .map(
                      (t) =>
                          `<div class="compact-task" data-key="${e(t.id)}">${icon('Music2', 13)}<span class="compact-title">${e(t.track.title)}</span><div class="progress-track"><span style="width:${t.progress}%"></span></div><span class="compact-speed">${statuses[t.status]}</span>${button(`取消 ${t.track.title}`, 'cancel', 'X', t.id, '', ['finalizing', 'canceling'].includes(t.status))}</div>`,
                  )
                  .join('')}</div></div></section>`
            : ''
    }
    <footer class="status-bar" data-key="footer"><button class="status-download" ${action('status')}>${icon('Download', 13)}${d.active.length ? `${d.active.length} 个任务 · ${d.running.length} 个执行中` : '下载队列空闲'}${d.active.length ? icon(s.queueExpanded ? 'ChevronDown' : 'ChevronUp', 12) : ''}</button><div class="status-right"><span class="status-info">${icon('SlidersHorizontal', 12)}未连接服务</span><span class="status-divider"></span><span class="status-info">${icon('Folder', 13)}${e(destinations.find((x) => x.id === s.settings.destination)?.name ?? '')}</span></div></footer>${s.toast ? `<div class="toast" role="status" data-key="toast">${icon('Check')}<span>${e(s.toast)}</span>${button('关闭提示', 'close-toast', 'X')}</div>` : ''}${taskMenuHTML(s)}${dialogHTML(s)}</div>`;
}
