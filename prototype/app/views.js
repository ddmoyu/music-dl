import { icon } from './icons.js';
import { escapeHTML as e } from './dom.js';
import { artwork, collectionTracks, qualityNames } from './data.js';
import { isPending } from './queue.js';

const statuses = {
    queued: '等待中',
    downloading: '下载中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
};
const checked = (value) => (value ? 'checked' : '');
const disabled = (value) => (value ? 'disabled' : '');
const active = (value) => (value ? 'active' : '');
const action = (name, id = '') => `data-action="${name}" data-id="${e(id)}"`;
const button = (label, name, symbol, id = '', cls = '', size = 14) =>
    `<button type="button" class="icon-button ${cls}" aria-label="${e(label)}" title="${e(label)}" ${action(name, id)}>${icon(symbol, size)}</button>`;
const qualitySelect = (settings, label) =>
    `<select aria-label="${label}" data-setting="quality">${Object.entries(qualityNames)
        .map(
            ([value, label]) =>
                `<option value="${value}" ${settings.quality === value ? 'selected' : ''}>${label}</option>`,
        )
        .join('')}</select>`;
const pauseAll = (d, size = 13) =>
    `<button class="text-button" ${action('toggle-all')}>${icon(d.allPaused ? 'Play' : 'Pause', size)}${d.allPaused ? '全部继续' : '全部暂停'}</button>`;

function taskControls(task) {
    const type =
        task.status === 'paused'
            ? ['继续', 'resume', 'Play']
            : task.status === 'failed'
              ? ['重试', 'retry', 'RotateCcw']
              : ['暂停', 'pause', 'Pause'];
    return `<div class="task-controls">${task.status !== 'completed' ? button(`${type[0]} ${task.track.title}`, type[1], type[2], task.id) + button(`移除 ${task.track.title}`, 'remove', 'X', task.id) : ''}</div>`;
}

function trackRow(track, s) {
    const existing = s.tasks.find(
        (t) => t.track.id === track.id && (isPending(t) || t.status === 'completed'),
    );
    const playing = s.preview?.id === track.id && s.previewPlaying;
    return `<tr data-key="${e(track.id)}" class="${s.selected.has(track.id) ? 'selected' : ''}">
        <td><input type="checkbox" aria-label="选择 ${e(track.title)}" data-select="${e(track.id)}" ${checked(s.selected.has(track.id))}></td>
        <td><div class="song-cell"><img src="${e(artwork(track.cover))}" alt=""><strong title="${e(track.title)}">${e(track.title)}</strong>${playing ? icon('AudioLines', 13, 'preview-wave') : ''}</div></td>
        <td class="muted"><span class="truncate" title="${e(track.artist)}">${e(track.artist)}</span></td>
        <td class="album-column muted"><span class="truncate" title="${e(track.album)}">${e(track.album)}</span></td>
        <td><span class="quality-badge ${track.quality === 'Hi-Res' ? 'hires' : ''}">${e(track.quality)}</span></td>
        <td class="duration-column numeric muted">${e(track.duration)}</td>
        <td><div class="row-actions">${button(`${playing ? '暂停试听' : '试听'} ${track.title}`, 'preview', playing ? 'Pause' : 'Play', track.id, active(s.preview?.id === track.id))}${button(existing?.status === 'completed' ? `重新下载 ${track.title}` : existing ? `${track.title} 已在队列` : `下载 ${track.title}`, 'download-track', existing?.status === 'completed' ? 'Check' : existing ? 'CheckCheck' : 'ArrowDownToLine', track.id, 'download-action', 15)}</div></td>
    </tr>`;
}

function collectionRow(item, s) {
    return `<tr data-key="${e(item.id)}" class="${s.selected.has(item.id) ? 'selected' : ''}">
        <td><input type="checkbox" aria-label="选择 ${e(item.title)}" data-select="${e(item.id)}" ${checked(s.selected.has(item.id))}></td>
        <td><button class="collection-name" ${action('collection', item.id)}><img src="${e(artwork(item.cover))}" alt=""><span>${e(item.title)}<small>${e(item.kind === 'playlist' ? item.subtitle : item.tag)}</small></span>${icon('ChevronRight', 13)}</button></td>
        <td class="muted"><span class="truncate">${e(item.kind === 'album' ? item.subtitle : item.tag)}</span></td>
        <td class="album-column muted">${item.tracks.length} 首</td>
        <td class="muted small-text">${e([...new Set(collectionTracks(item).map((t) => t.source))].join(' / '))}</td><td class="duration-column"></td>
        <td><button class="inline-download" ${action('download-collection', item.id)}>${icon('Download', 14)}下载</button></td>
    </tr>`;
}

function searchPage(s, d) {
    return `<section class="search-panel" data-key="search-panel">
        <div class="search-mode-row"><div class="search-types" aria-label="搜索类型">${[
            ['tracks', '单曲', 'Music2'],
            ['playlists', '歌单', 'ListMusic'],
            ['albums', '专辑', 'Disc3'],
        ]
            .map(
                ([id, label, symbol]) =>
                    `<button class="${active(s.searchType === id)}" aria-pressed="${s.searchType === id}" ${action('search-type', id)}>${icon(symbol)}${label}</button>`,
            )
            .join('')}</div><span class="search-hint">找到，就下载。</span></div>
        <form class="search-form" data-form="search"><div class="search-input">${icon('Search', 18)}<input id="search-input" value="${e(s.search)}" placeholder="${s.searchType === 'tracks' ? '搜索歌曲名、歌手名' : s.searchType === 'playlists' ? '搜索歌单名称、关键词' : '搜索专辑名、歌手名'}" aria-label="搜索音乐" maxlength="200">${s.search ? button('清空搜索', 'clear-search', 'X') : '<kbd>Ctrl K</kbd>'}</div>
        <select aria-label="音乐来源" id="source">${['全部来源', '酷我音乐', '5sing'].map((source) => `<option ${s.source === source ? 'selected' : ''}>${source}</option>`).join('')}</select>
        <button class="button primary search-submit" type="submit">${icon('Search')}搜索</button></form>
    </section>
    <div class="results-heading" data-key="results-heading">${s.collection ? `<div class="collection-breadcrumb"><button ${action('back')}>${icon('ArrowLeft', 14)}返回</button><span class="separator"></span><strong>${e(s.collection.title)}</strong><span>${d.shownTracks.length} 首</span></div>` : `<span>${s.query ? `「<strong>${e(s.query)}</strong>」<span class="result-count">${d.resultIds.length} ${d.showingTracks ? '首歌曲' : s.searchType === 'playlists' ? '个歌单' : '张专辑'}</span>` : '搜索结果'}</span>`}${s.query && d.resultIds.length ? `<button class="text-button" ${action('download-all')}>${icon('ArrowDownToLine', 13)}下载全部${d.showingTracks ? '' : ` · ${d.allResultTracks.length} 首`}</button>` : ''}</div>
    ${s.query && d.resultIds.length ? `<div class="results-scroll" data-key="results"><table class="results-table ${d.showingTracks ? '' : 'collections-table'}"><thead><tr><th class="check-column"><input type="checkbox" aria-label="全选搜索结果" data-select-all ${checked(d.allSelected)}></th><th>${d.showingTracks ? '歌曲' : s.searchType === 'albums' ? '专辑' : '歌单'}</th><th>${d.showingTracks ? '歌手' : s.searchType === 'albums' ? '歌手 / 发行时间' : '风格'}</th><th class="album-column">${d.showingTracks ? '专辑' : '歌曲数量'}</th><th class="quality-column">${d.showingTracks ? '音质' : '来源'}</th><th class="duration-column">${d.showingTracks ? '时长' : ''}</th><th class="actions-column">操作</th></tr></thead><tbody>${d.showingTracks ? d.shownTracks.map((t) => trackRow(t, s)).join('') : d.resultCollections.map((c) => collectionRow(c, s)).join('')}</tbody></table></div>` : `<div class="empty-results" data-key="empty-search"><div class="empty-search-mark">${icon('Search', 30)}<span>${icon('ArrowDownToLine', 12)}</span></div><h2>${s.query ? '没有找到相关结果' : '想下载什么音乐？'}</h2><p>${s.query ? '试试其他关键词，或切换音乐来源。' : '搜索单曲、歌单或专辑，选中后一键下载。'}</p>${!s.query && s.history.length ? `<div class="search-history"><span>最近搜索</span>${s.history.map((item) => `<button ${action('history', item)}>${e(item)}</button>`).join('')}${button('清空搜索历史', 'clear-history', 'Trash2', '', '', 12)}</div>` : ''}</div>`}
    <div class="batch-toolbar" data-key="batch"><label class="select-all"><input type="checkbox" aria-label="全选" data-select-all ${checked(d.allSelected)} ${disabled(!d.resultIds.length)}>全选</label><span class="selection-count">已选 <b>${s.selected.size}</b> ${d.showingTracks ? '首' : s.searchType === 'playlists' ? '个歌单' : '张专辑'}</span><div class="batch-right">${qualitySelect(s.settings, '下载音质')}<button class="button primary" ${action('download-selected')} ${disabled(!d.selectedTracks.length)}>${icon('Download')}下载所选${d.selectedTracks.length ? `<span class="button-count">${d.selectedTracks.length}</span>` : ''}</button></div></div>`;
}

function downloadsPage(s, d) {
    const completed = d.completed.filter((t) => !t.historyHidden);
    const visible =
        s.downloadTab === '进行中' ? d.active : s.downloadTab === '已完成' ? completed : d.failed;
    return `<div class="downloads-page"><div class="downloads-heading"><div class="task-tabs">${[
        ['进行中', d.active.length],
        ['已完成', completed.length],
        ['失败', d.failed.length],
    ]
        .map(
            ([label, count]) =>
                `<button class="${active(s.downloadTab === label)}" ${action('download-tab', label)}>${label}<span>${count}</span></button>`,
        )
        .join(
            '',
        )}</div><div class="download-tools">${d.active.length ? pauseAll(d) : ''}${s.downloadTab === '已完成' && visible.length ? `<button class="text-button" ${action('clear-completed')}>${icon('Trash2', 13)}清除记录</button>` : ''}<button class="text-button" ${action('open-directory')}>${icon('Folder', 13)}打开目录</button></div></div>
    ${visible.length ? `<div class="task-list" data-key="task-list">${visible.map((t) => `<div data-key="${e(t.id)}" class="download-row ${t.status}"><img src="${e(artwork(t.track.cover))}" alt=""><div class="task-song"><strong>${e(t.track.title)}</strong><span>${e(t.track.artist)} · ${e(t.quality)} · ${t.totalMB.toFixed(1)} MB</span>${t.error ? `<p class="task-error">${e(t.error)}</p>` : ''}</div><div class="task-progress"><div><span>${statuses[t.status]}</span><span class="numeric">${t.status === 'downloading' ? `${t.speed.toFixed(1)} MB/s` : `${Math.floor(t.progress)}%`}</span></div><div class="progress-track" role="progressbar" aria-label="${e(t.track.title)} 下载进度" aria-valuenow="${Math.floor(t.progress)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${t.progress}%"></span></div></div>${t.status === 'completed' ? icon('Check', 17, 'completed-check') : taskControls(t)}</div>`).join('')}</div>` : `<div class="empty-results" data-key="empty-downloads"><div class="empty-search-mark">${icon(s.downloadTab === '失败' ? 'Check' : 'ArrowDownToLine', 28)}</div><h2>${s.downloadTab === '失败' ? '没有失败的下载' : s.downloadTab === '已完成' ? '暂无完成记录' : '当前没有下载任务'}</h2><p>${s.downloadTab === '进行中' ? '搜索音乐，选择歌曲后即可开始下载。' : s.downloadTab === '失败' ? '下载遇到问题时，可以在这里重试。' : '下载完成的歌曲会显示在这里。'}</p><button class="text-button green" ${action('view', 'search')}>搜索音乐${icon('ArrowRight', 13)}</button></div>`}</div>`;
}

function settingsPage(s) {
    const row = (title, hint, control) =>
        `<div class="setting-row"><div><h3>${title}</h3><p>${hint}</p></div>${control}</div>`;
    const toggle = (key, label) =>
        `<button type="button" class="toggle ${s.settings[key] ? 'on' : ''}" role="switch" aria-checked="${s.settings[key]}" aria-label="${label}" ${action('toggle-setting', key)}><span></span></button>`;
    return `<div class="settings-page"><div class="settings-heading"><h1>下载设置</h1><span>${icon('Check', 13)}自动保存</span></div>
    <div class="settings-section"><h2>${icon('AudioLines', 16)}音质与任务</h2>
        ${row('默认音质', '加入队列时自动使用此音质', qualitySelect(s.settings, '默认下载音质'))}
        ${row('并行下载', '同时下载 1–8 首，修改后立即生效', `<div class="stepper"><button aria-label="减少并行数量" ${action('concurrency', '-1')} ${disabled(s.settings.concurrency <= 1)}>−</button><span>${s.settings.concurrency}</span><button aria-label="增加并行数量" ${action('concurrency', '1')} ${disabled(s.settings.concurrency >= 8)}>${icon('Plus', 13)}</button></div>`)}
        ${row('无损不可用时使用较低音质', '避免因音质不足中断下载', toggle('allowLower', '无损不可用时使用较低音质'))}
        ${row('跳过已下载的歌曲', '已在队列中的歌曲始终自动去重', toggle('skipDuplicates', '跳过已下载的歌曲'))}
    </div><div class="settings-section"><h2>${icon('Folder', 16)}文件保存</h2>
        <div class="directory-setting"><span>下载目录</span><div class="directory-field">${icon('Folder')}<span title="${e(s.settings.directory)}">${e(s.settings.directory)}</span><button ${action('choose-directory')}>更改${icon('ChevronRight', 13)}</button></div></div>
        ${row(
            '文件整理',
            '新任务按此方式创建子目录',
            `<select aria-label="文件整理方式" data-setting="organize">${[
                ['artist', '按歌手分类'],
                ['album', '按专辑分类'],
                ['flat', '不分类'],
            ]
                .map(
                    ([value, label]) =>
                        `<option value="${value}" ${s.settings.organize === value ? 'selected' : ''}>${label}</option>`,
                )
                .join('')}</select>`,
        )}
        ${row('写入歌曲信息与封面', '保留歌名、歌手、专辑和封面', toggle('metadata', '写入歌曲信息与封面'))}
        ${row('同时下载歌词', '另存为 LRC 文件', toggle('lyrics', '同时下载歌词'))}
    </div><button class="text-button reset-settings" ${action('reset-settings')}>恢复默认设置</button></div>`;
}

export function appHTML(s, d) {
    return `<div class="app-window">
        <header class="app-header" data-key="header"><div class="brand"><span class="brand-mark">${icon('AudioLines', 19)}</span><strong>拾音</strong><span class="brand-description">音乐下载工具</span></div><nav class="main-nav"><button class="${active(s.view === 'search')}" ${action('view', 'search')}>${icon('Search', 14)}搜索音乐</button><button class="${active(s.view === 'downloads')}" ${action('view', 'downloads')}>${icon('ArrowDownToLine', 14)}下载任务${d.active.length ? `<span>${d.active.length}</span>` : ''}</button></nav><div class="header-settings">${button('下载设置', 'settings', 'Settings2', '', active(s.view === 'settings'), 17)}</div></header>
        <main class="main-panel ${s.view}" data-key="${s.view}">${s.view === 'search' ? searchPage(s, d) : s.view === 'downloads' ? downloadsPage(s, d) : settingsPage(s)}</main>
        ${s.preview ? `<div class="preview-strip" data-key="preview">${icon('AudioLines', 14)}<strong>${e(s.preview.title)}</strong><span>试听 · ${String(Math.floor(s.previewSeconds / 60)).padStart(2, '0')}:${String(s.previewSeconds % 60).padStart(2, '0')} / 00:30</span><div class="preview-progress"><span style="width:${(s.previewSeconds / 30) * 100}%"></span></div>${button(s.previewPlaying ? '暂停试听' : '继续试听', 'preview', s.previewPlaying ? 'Pause' : 'Play', s.preview.id, '', 13)}${button('关闭试听', 'stop-preview', 'X', '', '', 13)}</div>` : ''}
        ${
            s.view !== 'downloads'
                ? `<section class="queue-drawer" data-key="drawer" data-expanded="${!!(s.queueExpanded && d.active.length)}" aria-hidden="${!(s.queueExpanded && d.active.length)}"><div class="queue-drawer-content"><div class="drawer-heading"><span>下载队列 <b>${d.active.length}</b></span><div>${pauseAll(d, 12)}<button class="text-button" ${action('view', 'downloads')}>全部任务${icon('ChevronRight', 12)}</button>${button('收起下载队列', 'collapse-queue', 'ChevronDown', '', '', 15)}</div></div><div class="compact-queue">${d.active
                      .slice(0, 3)
                      .map(
                          (t) =>
                              `<div class="compact-task ${t.status}" data-key="${e(t.id)}">${icon('Music2', 13)}<span class="compact-title">${e(t.track.title)}<small>${e(t.track.artist)}</small></span><span class="compact-quality">${e(t.quality)}</span><div class="progress-track"><span style="width:${t.progress}%"></span></div><span class="compact-speed numeric">${t.status === 'downloading' ? `${t.speed.toFixed(1)} MB/s` : statuses[t.status]}</span><span class="compact-percent numeric">${Math.floor(t.progress)}%</span>${taskControls(t)}</div>`,
                      )
                      .join('')}</div></div></section>`
                : ''
        }
        <footer class="status-bar" data-key="footer"><button class="status-download" ${action('status')}>${icon(d.running.length ? 'LoaderCircle' : 'ArrowDownToLine', 13, d.running.length ? 'spin' : '')}<span>${d.running.length ? `${d.running.length} 正在下载` : d.active.length ? `${d.active.length} 个任务已暂停或等待` : '下载队列空闲'}</span>${d.running.length ? `<b class="numeric">${d.totalSpeed.toFixed(1)} MB/s</b>` : ''}${d.active.length && s.view !== 'downloads' ? icon(s.queueExpanded ? 'ChevronDown' : 'ChevronUp', 12) : ''}</button><div class="status-right"><button ${action('view', 'settings')}>${icon('SlidersHorizontal', 12)}${s.settings.concurrency} 首并行</button><span class="status-divider"></span><button class="status-directory" title="${e(s.settings.directory)}" ${action('open-directory')}>${icon('Folder', 13)}<span>${e(s.settings.directory)}</span></button></div></footer>
        ${s.toast ? `<div class="toast" role="status" data-key="toast">${icon('Check')}<span>${e(s.toast)}</span>${button('关闭提示', 'close-toast', 'X', '', '', 13)}</div>` : ''}
        ${s.directoryDialog ? `<div class="modal-backdrop" data-key="directory-modal"><form class="modal" data-form="directory" role="dialog" aria-modal="true" aria-labelledby="directory-title"><div class="modal-heading"><h2 id="directory-title">下载目录</h2>${button('关闭', 'close-directory', 'X', '', '', 16)}</div><label for="directory-input">文件夹路径</label><input id="directory-input" value="${e(s.directoryDraft)}" required><div class="modal-actions"><button type="button" class="button secondary" ${action('close-directory')}>取消</button><button type="submit" class="button primary" ${disabled(!s.directoryDraft.trim())}>保存</button></div></form></div>` : ''}
    </div>`;
}
