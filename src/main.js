import {
    Api,
    supports,
    sourceLabel,
    sortProviders,
    identity,
    terminal,
    downloadIntent,
    compactText,
} from './api.js';
import { bootService, openDownloads } from './desktop.js';
import { readPreferences, savePreferences } from './preferences.js';
import { Pager, virtualWindow } from './paging.js';
import { searchPage, collectionPage } from './catalog.js';
import { canTaskAction, watchTasks } from './tasks.js';
import { TaskList } from './task-list.js';
import { TaskSync } from './task-sync.js';
import { DownloadSubmission } from './download-submission.js';
import { Preview } from './preview.js';
import { escapeHTML, updateHTML } from './dom.js';
import { icon } from './icons.js';
import { Accounts, accountStatus, membershipText, verificationHint } from './accounts.js';
import { trackPay } from './track-pay.js';
import './styles.css';

const root = document.querySelector('#root');
const brandIcon = `${import.meta.env.BASE_URL}favicon.svg`;
const esc = escapeHTML;
const state = {
    ready: false,
    startupError: '',
    view: 'search',
    type: 'tracks',
    query: '',
    source: 'all',
    providers: [],
    destinations: [],
    detail: null,
    trail: [],
    selected: new Set(),
    taskSelected: new Set(),
    taskFilter: '',
    top: 0,
    taskTop: 0,
    height: 400,
    busy: false,
    toast: '',
    syncError: '',
    settings: { quality: 'standard', qualityPolicy: 'allow_lower', destination: 'dst_default' },
    hidden: new Set(),
    names: {},
    credentials: [],
    credentialSource: '',
    credentialProfile: '',
    credentialId: '',
    paused: false,
};
let api,
    accounts,
    session,
    stopWatch,
    toastTimer,
    frame,
    player,
    submission,
    taskSync,
    lastSelected = -1;
const catalog = new Pager(render);
const tasks = new TaskList(render);
let renderedController, renderedView;
const titles = {
    tracks: '歌曲',
    playlists: '歌单',
    albums: '专辑',
    artists: '歌手',
    charts: '排行榜',
    recommendations: '推荐歌单',
    search: '搜索音乐',
    downloads: '下载任务',
    settings: '设置',
};
const statusText = {
    queued: '排队中',
    resolving: '解析音源',
    probing: '检查音源',
    downloading: '下载中',
    processing: '处理文件',
    finalizing: '保存中',
    waiting_retry: '等待重试',
    canceling: '取消中',
    completed: '已完成',
    failed: '失败',
    canceled: '已取消',
};
const button = (action, text, disabled = false, extra = '') =>
    `<button type="button" data-action="${esc(action)}" ${disabled ? 'disabled' : ''} ${extra}>${text}</button>`;
const selectedItems = () => catalog.items.filter((item) => state.selected.has(identity(item)));
const visibleTasks = () => tasks.visible(state.hidden, state.taskFilter);
const capability = () =>
    state.view === 'charts'
        ? 'charts'
        : state.view === 'recommendations'
          ? 'recommend_playlists'
          : `search_${state.type}`;
const availableSources = () =>
    state.providers.filter((provider) => supports(provider, capability()));
const trackList = () =>
    state.detail
        ? state.detail.kind !== 'artists-albums'
        : state.view === 'search' && state.type === 'tracks';
const displayName = (item) => compactText(item.title || item.name || item.ref?.id || '');
const artistNames = (item) => (item.artists || []).map((artist) => artist.name).join(' / ');
const bytes = (value) =>
    !Number.isFinite(value)
        ? ''
        : value >= 1048576
          ? `${(value / 1048576).toFixed(1)} MB`
          : `${Math.round(value / 1024)} KB`;
function announce(message) {
    state.toast = message;
    clearTimeout(toastTimer);
    render();
    toastTimer = setTimeout(() => {
        state.toast = '';
        render();
    }, 5000);
}
async function persist(changes = {}) {
    const current = { ...state, pending: submission?.pending ?? null, ...changes };
    await savePreferences({
        settings: current.settings,
        hidden: [...current.hidden],
        names: Object.fromEntries(Object.entries(current.names).slice(-2000)),
        pending: current.pending,
    });
}
function sourceSelect() {
    const sources = availableSources();
    return `<select aria-label="来源" id="source">${state.view === 'search' ? `<option value="all" ${state.source === 'all' ? 'selected' : ''}>全部来源</option>` : ''}${sources.map((p) => `<option value="${esc(p.source)}" ${p.source === state.source ? 'selected' : ''}>${esc(sourceLabel(p.source))}</option>`).join('')}</select>`;
}
function render() {
    if (!state.ready) {
        updateHTML(
            root,
            `<main class="startup"><div class="brand"><img src="${brandIcon}" alt="" width="36" height="36"><h1>曲袋</h1></div><p role="status">${esc(state.startupError || '正在启动本机音乐服务…')}</p>${state.startupError ? button('restart', '重新连接') : '<span class="spinner"></span>'}</main>`,
        );
        return;
    }
    const currentViewport = root.querySelector('.viewport');
    const controller = (state.view === 'downloads' ? tasks : catalog).controller;
    if (currentViewport && controller === renderedController && state.view === renderedView) {
        state[state.view === 'downloads' ? 'taskTop' : 'top'] = currentViewport.scrollTop;
        state.height = currentViewport.clientHeight || state.height;
    }
    if (state.view === 'downloads')
        state.taskTop = Math.min(
            state.taskTop,
            Math.max(0, visibleTasks().length * 84 - state.height),
        );
    const main =
        state.view === 'settings'
            ? settingsHTML()
            : state.view === 'downloads'
              ? downloadsHTML()
              : catalogHTML();
    updateHTML(
        root,
        `<div class="app"><header><div class="brand"><img src="${brandIcon}" alt="" width="29" height="29"><strong>曲袋</strong></div><nav aria-label="主导航">${['charts', 'recommendations', 'search', 'downloads'].map((view) => button(`nav:${view}`, titles[view], false, `class="${state.view === view ? 'active' : ''}" aria-current="${state.view === view ? 'page' : 'false'}"`)).join('')}${button('nav:settings', icon('settings', 17), false, `aria-label="设置" class="${state.view === 'settings' ? 'active' : ''}"`)}</nav></header>${main}<footer><span role="status" title="${esc(player.message)}">${esc(state.toast || state.syncError || player.message)}</span>${player.canSwitch ? button('switch-preview', player.busy ? '换源中…' : '换源', player.busy, `title="${esc(`已尝试 ${[...player.attemptedSources].map(sourceLabel).join(' / ')}`)}"`) : ''}${player.title ? button('stop-preview', '停止试听') : ''}<span class="connection" title="本机服务">${state.syncError ? '连接中断' : '已连接'}</span></footer></div>`,
    );
    const viewport = root.querySelector('.viewport');
    if (viewport) viewport.scrollTop = state.view === 'downloads' ? state.taskTop : state.top;
    renderedController = controller;
    renderedView = state.view;
}
function catalogHTML() {
    let toolbar;
    if (state.detail)
        toolbar = `<div class="toolbar">${button('back', '← 返回')}<h1>${esc(displayName(state.detail.item))}</h1>${
            state.detail.kind.startsWith('artists') &&
            supports(
                state.providers.find((p) => p.source === state.detail.item.ref.source),
                'artist_albums',
            )
                ? button(
                      'artist-tab',
                      state.detail.kind === 'artists-albums' ? '查看歌曲' : '查看专辑',
                  )
                : ''
        }</div>`;
    else if (state.view === 'search')
        toolbar = `<form id="search-form" class="search"><input id="query" aria-label="搜索关键词或链接" placeholder="搜索音乐，或粘贴分享链接" maxlength="4096" value="${esc(state.query)}"><button type="submit" class="primary">${icon('search', 17)} 搜索</button></form><div class="toolbar"><div class="tabs">${Object.entries(
            titles,
        )
            .filter(([key]) => ['tracks', 'playlists', 'albums', 'artists'].includes(key))
            .map(([key, title]) =>
                button(
                    `type:${key}`,
                    title,
                    false,
                    `class="${state.type === key ? 'active' : ''}"`,
                ),
            )
            .join('')}</div>${sourceSelect()}</div>`;
    else toolbar = `<div class="toolbar"><h1>${titles[state.view]}</h1>${sourceSelect()}</div>`;
    return `<section class="workspace">${toolbar}<div class="list-tools"><label><input type="checkbox" id="select-all" ${catalog.items.length && catalog.items.every((item) => state.selected.has(identity(item))) ? 'checked' : ''} ${!trackList() || !catalog.items.length ? 'disabled' : ''}> ${state.selected.size ? `已选 ${state.selected.size}` : `${catalog.items.length} 项`}</label>${trackList() ? button('download-selected', '下载所选', !state.selected.size || state.busy || !!submission.pending, 'class="primary"') : ''}</div>${submission.pending ? `<div class="notice">下载请求中断，结果尚未确认。${button('recover-submission', '重新确认', state.busy)}</div>` : ''}<div class="viewport" tabindex="0" aria-label="${state.detail ? '详情列表' : titles[state.view]}" data-key="catalog-scroll">${listHTML(false)}</div></section>`;
}
function downloadsHTML() {
    const chosen = tasks.items.filter((task) => state.taskSelected.has(task.task_id));
    const count = tasks.complete
        ? `${chosen.length ? `已选 ${chosen.length} / ` : ''}${visibleTasks().length} 项`
        : tasks.error
          ? '加载未完成'
          : '正在加载';
    return `<section class="workspace"><div class="toolbar"><h1>下载任务</h1><div class="actions">${button('open-folder', icon('folder', 16) + ' 下载目录')}${button('pause-queue', state.paused ? '继续队列' : '暂停新任务', state.busy)}</div></div><div class="toolbar"><div class="tabs">${[
        ['', '全部'],
        ['completed', '已完成'],
        ['failed', '失败'],
        ['canceled', '已取消'],
    ]
        .map(([value, label]) =>
            button(
                `filter:${value}`,
                label,
                false,
                `class="${state.taskFilter === value ? 'active' : ''}"`,
            ),
        )
        .join(
            '',
        )}</div>${button('refresh-tasks', '刷新', tasks.loading)}</div><div class="list-tools"><label><input type="checkbox" id="select-tasks" ${!tasks.complete || !visibleTasks().length ? 'disabled' : ''} ${visibleTasks().length && visibleTasks().every((task) => state.taskSelected.has(task.task_id)) ? 'checked' : ''}> ${count}</label><div class="actions">${button('task-cancel', '取消', state.busy || !chosen.some((t) => canTaskAction(t, 'cancel')))}${button('task-retry', '重试', state.busy || !chosen.some((t) => canTaskAction(t, 'retry')))}${button('task-hide', '移除记录', state.busy || !chosen.some(terminal))}</div></div>${submission.pending ? `<div class="notice">下载请求中断，结果尚未确认。${button('recover-submission', '重新确认', state.busy)}</div>` : ''}${state.paused ? '<div class="notice">新任务已暂停，正在执行的任务会继续。</div>' : ''}<div class="viewport" tabindex="0" aria-label="下载任务列表" data-key="task-scroll">${listHTML(true)}</div></section>`;
}
function listHTML(downloads) {
    const pager = downloads ? tasks : catalog;
    const items = downloads ? visibleTasks() : pager.items;
    const height = downloads ? 84 : 72;
    const window = virtualWindow(
        items.length,
        downloads ? state.taskTop : state.top,
        state.height,
        height,
    );
    const empty =
        !pager.loading && !items.length && !pager.error
            ? `<div class="empty">${icon(downloads ? 'download' : 'search', 28)}<p>${downloads ? '暂无下载任务' : !pager.fetchPage ? '输入关键词或粘贴链接开始' : '暂无结果'}</p></div>`
            : '';
    return `<div style="height:${window.before}px" aria-hidden="true"></div>${items
        .slice(window.start, window.end)
        .map((item) => (downloads ? taskHTML(item) : rowHTML(item)))
        .join(
            '',
        )}<div style="height:${window.after}px" aria-hidden="true"></div>${empty}<div class="list-end">${pager.loading ? '<span class="spinner"></span> 正在加载' : pager.error ? `<span role="alert">${esc(pager.error)}</span>${button(downloads ? 'refresh-tasks' : 'load-more', '重试')}` : downloads ? '' : pager.hasMore ? button('load-more', '继续加载') : pager.capped ? '已加载 5000 项，请缩小搜索范围' : items.length ? '已加载全部' : ''}</div>`;
}
function rowHTML(item) {
    const id = identity(item),
        track = trackList(),
        playing = player.id === id && player.status !== 'failed';
    const pay = trackPay(item.pay);
    const caption =
        artistNames(item) ||
        item.creator?.name ||
        (typeof item.creator === 'string' ? item.creator : '') ||
        item.description ||
        '';
    const artwork =
        typeof item.artwork === 'string' && /^https?:\/\//.test(item.artwork) ? item.artwork : null;
    const disabled =
        track &&
        !supports(
            state.providers.find((p) => p.source === item.ref?.source),
            'resolve_audio',
        );
    return `<article class="row ${state.selected.has(id) ? 'selected' : ''}" data-key="${esc(id)}"><input type="checkbox" aria-label="选择 ${esc(displayName(item))}" data-select="${esc(id)}" ${state.selected.has(id) ? 'checked' : ''} ${!track || disabled ? 'disabled' : ''}><div class="cover">${artwork ? `<img src="${esc(artwork)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon(track ? 'music' : 'folder', 20)}</div><div class="row-copy"><div class="row-title"><button class="title" data-open="${esc(id)}" ${track ? 'disabled' : ''}>${esc(displayName(item))}</button>${track && pay.badge ? `<span class="pay-badge" title="${esc(pay.tooltip)}">${esc(pay.badge)}</span>` : ''}</div><p title="${esc(compactText(caption))}">${esc(compactText(caption || (track ? item.album?.title : '') || '—'))}</p></div>${state.source === 'all' && !state.detail ? `<span class="source-badge">${esc(sourceLabel(item.ref?.source))}</span>` : ''}${track ? `<div class="actions">${button(`preview:${id}`, icon(playing ? 'stop' : 'play', 16), disabled, `aria-label="${playing ? '停止试听' : '试听'} ${esc(displayName(item))}" title="${playing ? '停止试听' : esc(pay.playHint)}" aria-pressed="${playing}"`)}${button(`download:${id}`, icon('download', 16), disabled || state.busy || !!submission.pending, `aria-label="下载 ${esc(displayName(item))}" title="${esc(pay.downloadHint)}"`)}</div>` : button(`open:${id}`, '查看')}</article>`;
}
function taskHTML(task) {
    const progress = task.progress || {},
        pendingSource = task.source_retry?.pending && !terminal(task),
        percent =
            !pendingSource && progress.total_bytes > 0
                ? Math.min(100, (progress.received_bytes / progress.total_bytes) * 100)
                : null;
    const title =
        state.names[identity({ ref: task.original_track })] ||
        task.original_track?.id ||
        task.task_id;
    const source = sourceLabel(task.original_track?.source || ''),
        actual = sourceLabel(task.actual_track?.source || ''),
        provenance = task.source_switched && actual ? `${source} → ${actual}` : source;
    const attempted = task.source_retry?.attempted_sources || [];
    const progressDetail =
        task.error?.message ||
        task.warnings?.map((warning) => warning.message || warning.code).join(' · ') ||
        [
            bytes(progress.received_bytes),
            progress.total_bytes ? `/ ${bytes(progress.total_bytes)}` : '',
            progress.speed_bytes_per_second ? `${bytes(progress.speed_bytes_per_second)}/s` : '',
        ]
            .filter(Boolean)
            .join(' ');
    const detail = [provenance, progressDetail].filter(Boolean).join(' · ');
    const hint = [
        detail,
        attempted.length ? `已尝试 ${attempted.map(sourceLabel).join(' / ')}` : '',
    ]
        .filter(Boolean)
        .join(' · ');
    return `<article class="row task-row ${state.taskSelected.has(task.task_id) ? 'selected' : ''}" data-key="${esc(task.task_id)}" data-task="${esc(task.task_id)}"><input type="checkbox" aria-label="选择任务 ${esc(title)}" data-task-select="${esc(task.task_id)}" ${state.taskSelected.has(task.task_id) ? 'checked' : ''}><div class="row-copy"><strong>${esc(title)}</strong><p title="${esc(hint)}">${esc(detail)}</p>${percent !== null && !terminal(task) ? `<progress max="100" value="${percent}" aria-label="下载进度"></progress>` : ''}</div><span class="status ${task.status === 'failed' ? 'danger' : ''}">${pendingSource ? '等待换源' : statusText[task.status] || esc(task.status)}${percent !== null && !terminal(task) ? ` ${Math.floor(percent)}%` : ''}</span><div class="actions">${canTaskAction(task, 'cancel') ? button(`cancel:${task.task_id}`, '取消', state.busy) : ''}${canTaskAction(task, 'retry') ? button(`retry:${task.task_id}`, '重试', state.busy) : ''}${terminal(task) ? button(`hide:${task.task_id}`, icon('close', 16), state.busy, 'aria-label="移除记录"') : ''}${button(`menu:${task.task_id}`, '⋯', state.busy, 'aria-label="任务操作"')}</div></article>`;
}
function accountsHTML(sources, provider, methods) {
    const editing = state.credentials.find((item) => item.credential_id === state.credentialId);
    const switching = state.credentials.some(
        (item) =>
            item.source === provider?.source &&
            item.enabled &&
            item.credential_id !== editing?.credential_id,
    );
    return `<div class="settings-group"><h2>平台账号</h2><form id="credential-form">
        <div class="credential-options"><select id="credential-source" aria-label="凭据来源" ${editing ? 'disabled' : ''}>${sources.map((p) => `<option value="${esc(p.source)}" ${p.source === provider?.source ? 'selected' : ''}>${esc(sourceLabel(p.source))}</option>`).join('')}</select>
        <select id="credential-profile" aria-label="凭据类型" ${editing ? 'disabled' : ''}>${methods.map((m) => `<option value="${esc(m.auth_profile)}" ${m.auth_profile === (editing?.auth_profile || state.credentialProfile) ? 'selected' : ''}>${esc(m.auth_profile === 'web_cookie' ? '网页 Cookie' : m.auth_profile)}</option>`).join('')}</select>
        <button type="submit" ${state.busy || !methods.length ? 'disabled' : ''}>${editing?.enabled ? '保存更新' : '保存并启用'}</button>${editing ? button('credential-new', '取消') : ''}</div>
        <input id="credential-label" data-private aria-label="账号名称" placeholder="账号名称（选填）" maxlength="128" value="${esc(editing?.label || '')}">
        <textarea id="cookie" aria-label="Cookie" placeholder="${editing?.enabled ? '粘贴新 Cookie；留空仅修改名称' : '粘贴 Cookie'}" autocomplete="off" spellcheck="false" maxlength="32768"></textarea>
        ${switching ? '<p class="account-note">启用后，同平台原账号将停用并清除 Cookie。</p>' : editing && !editing.enabled ? '<p class="account-note">已停用账号需重新填写 Cookie 才能启用。</p>' : ''}
        </form>${accounts?.error ? `<p role="alert" class="account-note danger">${esc(compactText(accounts.error))}${button('credential-refresh', '重试')}</p>` : ''}
        <div class="credentials">${state.credentials
            .map((item) => {
                const method = state.providers
                    .find((p) => p.source === item.source)
                    ?.auth_methods.find((m) => m.auth_profile === item.auth_profile);
                const pending = item.verification?.state === 'pending';
                const selected =
                    accounts?.selections[item.source]?.credential_id === item.credential_id;
                const checkHint = verificationHint(item.verification?.error_code);
                return `<div class="credential" data-key="${esc(item.credential_id)}"><div class="credential-copy"><strong>${esc(compactText(item.label || sourceLabel(item.source)))}</strong>
                <p>${esc(sourceLabel(item.source))} · ${selected && item.enabled ? '使用中 · ' : ''}${accountStatus(item)}</p>
                ${item.enabled ? `<p title="${esc(item.membership?.checked_at ? `最近查询：${new Date(item.membership.checked_at).toLocaleString('zh-CN')}` : '尚未确认会员信息')}">${esc(membershipText(item.membership))}</p>` : ''}
                ${checkHint && item.enabled ? `<p>${esc(checkHint)}</p>` : ''}
                ${item.enabled && item.membership?.error_code && item.membership.error_code !== item.verification?.error_code ? '<p>会员信息暂不可用</p>' : ''}
                ${item.secret_cleanup_pending ? '<p class="danger">Cookie 清理未完成</p>' : ''}</div>
                <div class="actions">${item.status !== 'revoked' ? button(`credential-edit:${item.credential_id}`, item.enabled ? '更新' : '启用', state.busy || !method) : ''}
                ${pending ? button(`credential-cancel:${item.credential_id}`, '取消校验', state.busy) : item.enabled && method?.supports_verify ? button(`credential-verify:${item.credential_id}`, '验证', state.busy) : ''}
                ${item.enabled || item.secret_cleanup_pending ? button(`credential-disable:${item.credential_id}`, item.secret_cleanup_pending && !item.enabled ? '重试清理' : '停用', state.busy) : ''}
                ${item.status !== 'revoked' ? button(`credential-delete:${item.credential_id}`, '删除', state.busy) : ''}</div></div>`;
            })
            .join('')}</div></div>`;
}
function settingsHTML() {
    const sources = state.providers.filter((p) =>
        p.auth_methods.some((method) => method.kind === 'cookie'),
    );
    const provider = sources.find((p) => p.source === state.credentialSource) || sources[0];
    const methods = provider?.auth_methods.filter((m) => m.kind === 'cookie') || [];
    return `<section class="settings"><h1>设置</h1><div class="settings-group"><h2>下载</h2><label>音质<select id="quality">${[
        ['standard', '标准'],
        ['high', '高音质'],
        ['lossless', '无损'],
        ['hires', 'Hi-Res'],
    ]
        .map(
            ([value, label]) =>
                `<option value="${value}" ${value === state.settings.quality ? 'selected' : ''}>${label}</option>`,
        )
        .join(
            '',
        )}</select></label><label>所选音质不可用<select id="quality-policy"><option value="allow_lower" ${state.settings.qualityPolicy === 'allow_lower' ? 'selected' : ''}>允许降低音质</option><option value="strict" ${state.settings.qualityPolicy === 'strict' ? 'selected' : ''}>报告失败</option></select></label><label>保存位置<span class="path">${esc(session.downloads)}</span>${button('open-folder', '打开')}</label><label>目标<select id="destination">${state.destinations
        .filter((d) => d.available && d.accept_new_tasks)
        .map(
            (d) =>
                `<option value="${esc(d.destination_id)}" ${state.settings.destination === d.destination_id ? 'selected' : ''}>${esc(d.name)}</option>`,
        )
        .join('')}</select></label></div>${accountsHTML(sources, provider, methods)}</section>`;
}
function resetCatalog() {
    state.trail = [];
    state.detail = null;
    state.selected.clear();
    state.top = 0;
    catalog.reset(null);
}
async function loadCatalog() {
    state.top = 0;
    state.selected.clear();
    if (state.detail) {
        const { kind, item } = state.detail;
        const path = kind === 'artists-albums' ? '/artists/albums' : `/${kind}/tracks`;
        catalog.reset(
            kind === 'artists-search'
                ? searchPage(api, state.providers, 'tracks', item.ref.source, item.name)
                : collectionPage(api, path, item.ref),
        );
    } else if (state.view === 'search') {
        catalog.reset(
            state.query.trim()
                ? searchPage(api, state.providers, state.type, state.source, state.query.trim())
                : null,
        );
    } else {
        const sources = availableSources();
        if (!sources.some((p) => p.source === state.source))
            state.source =
                sources.find((p) => p.source === 'kuwo')?.source || sources[0]?.source || '';
        catalog.reset(
            state.source
                ? collectionPage(
                      api,
                      state.view === 'charts' ? '/charts' : '/recommendations/playlists',
                      { source: state.source },
                  )
                : null,
        );
    }
    render();
    await catalog.load();
}
async function search() {
    state.query = root.querySelector('#query').value.trim();
    resetCatalog();
    if (/https?:\/\//i.test(state.query)) {
        const controller = catalog.controller;
        const { data } = await api.request('/links/parse', {
            method: 'POST',
            body: { text: state.query },
            signal: controller.signal,
        });
        if (!data.matched || !data.ref) throw new Error('未识别到支持的音乐链接');
        const kind = { track: 'tracks', playlist: 'playlists', album: 'albums', artist: 'artists' }[
            data.kind
        ];
        if (!kind) throw new Error('暂不支持此链接类型');
        const result = await api.request(`/${kind}/detail`, {
            query: data.ref,
            signal: controller.signal,
        });
        if (controller !== catalog.controller) return;
        if (kind === 'tracks') {
            state.type = 'tracks';
            catalog.items = [result.data];
            catalog.hasMore = false;
            render();
        } else {
            state.detail = { kind, item: result.data };
            await loadCatalog();
        }
    } else await loadCatalog();
}
async function openItem(item) {
    if (!item) return;
    state.trail.push({
        detail: state.detail,
        page: catalog.snapshot(),
        top: root.querySelector('.viewport')?.scrollTop ?? state.top,
        selected: new Set(state.selected),
    });
    if (state.trail.length > 8) state.trail.shift();
    const kind =
        state.detail?.kind === 'artists-albums'
            ? 'albums'
            : state.view === 'charts'
              ? 'charts'
              : state.view === 'recommendations'
                ? 'playlists'
                : state.type;
    state.detail = {
        kind:
            kind === 'artists' &&
            !supports(
                state.providers.find((p) => p.source === item.ref.source),
                'artist_tracks',
            )
                ? 'artists-search'
                : kind,
        item,
    };
    await loadCatalog();
}
async function navigate(view) {
    closeMenu();
    accounts?.stop();
    state.view = view;
    if (view === 'downloads') {
        render();
        if (!tasks.fetchPage || (!tasks.complete && !tasks.loading)) await resetTasks();
        else {
            taskSync.receive(null);
            stopWatch?.refresh?.();
        }
    } else if (view === 'settings') {
        await credentials();
        render();
    } else {
        resetCatalog();
        await loadCatalog();
    }
}
async function resetTasks() {
    state.taskTop = 0;
    lastSelected = -1;
    state.taskSelected.clear();
    tasks.reset(async (cursor, signal) => {
        const { data } = await api.request('/downloads', { query: { limit: 100, cursor }, signal });
        return { items: data.items, nextCursor: data.page.next_cursor };
    });
    taskSync.refresh.clear();
    await tasks.load();
    if (tasks.complete) {
        taskSync.receive(null);
        stopWatch?.refresh?.();
    }
}
const synchronizeTasks = () => taskSync.synchronize(state.view === 'downloads');
async function enqueue(items) {
    if (!items.length) return;
    if (submission.pending) throw new Error('请先确认上次提交结果');
    for (let offset = 0; offset < items.length; offset += 100) {
        const chunk = items.slice(offset, offset + 100);
        for (const item of chunk) state.names[identity(item)] = displayName(item);
        await submission.submit({
            key: crypto.randomUUID(),
            route: '/download-batches',
            body: { items: chunk.map((item) => downloadIntent(item, state.settings)) },
        });
    }
    state.selected.clear();
    announce(`已提交 ${items.length} 首歌曲`);
}
async function taskAction(action, ids) {
    const chosen = tasks.items.filter(
        (task) => ids.includes(task.task_id) && canTaskAction(task, action),
    );
    if (action === 'hide') {
        if (!chosen.length || !confirm(`从列表移除 ${chosen.length} 条记录？已下载的文件会保留。`))
            return;
        const hidden = new Set(state.hidden);
        chosen.forEach((task) => hidden.add(task.task_id));
        await persist({ hidden });
        state.hidden = hidden;
        chosen.forEach((task) => state.taskSelected.delete(task.task_id));
        render();
        return;
    }
    const errors = [];
    for (const task of chosen) {
        try {
            if (action === 'retry') {
                if (submission.pending) throw new Error('请先确认上次提交结果');
                await submission.submit({
                    key: crypto.randomUUID(),
                    route: `/downloads/${encodeURIComponent(task.task_id)}/retry`,
                });
            } else {
                await api.request(`/downloads/${encodeURIComponent(task.task_id)}/cancel`, {
                    method: 'POST',
                });
                taskSync.refresh.add(task.task_id);
            }
        } catch (error) {
            errors.push(error.message);
            if (submission.pending) break;
        }
    }
    await synchronizeTasks();
    announce(errors.length ? errors.join('；') : '操作已提交');
}
async function credentials() {
    await accounts.refresh();
}
async function saveCredential() {
    const source = root.querySelector('#credential-source').value,
        auth_profile = root.querySelector('#credential-profile').value;
    const field = root.querySelector('#cookie'),
        cookie = field.value.trim();
    const label =
        root.querySelector('#credential-label').value.trim() || `${sourceLabel(source)} Cookie`;
    const current = state.credentials.find((item) => item.credential_id === state.credentialId);
    if (!cookie && (!current || !current.enabled)) throw new Error('请填写新的 Cookie 后启用');
    field.value = '';
    await changeAccount(async () => {
        if (!current) {
            await api.request('/credentials', {
                method: 'POST',
                body: {
                    source,
                    kind: 'cookie',
                    auth_profile,
                    label,
                    enabled: true,
                    secret: { cookie },
                },
            });
        } else if (current.enabled) {
            await api.request(`/credentials/${encodeURIComponent(current.credential_id)}`, {
                method: 'PUT',
                body: { label, ...(cookie ? { secret: { cookie } } : {}) },
            });
        } else {
            if (label !== current.label)
                await api.request(`/credentials/${encodeURIComponent(current.credential_id)}`, {
                    method: 'PUT',
                    body: { label },
                });
            await api.request(`/credential-defaults/${encodeURIComponent(source)}`, {
                method: 'PUT',
                body: { credential_id: current.credential_id, secret: { cookie } },
            });
        }
    });
    editCredential('');
    announce(cookie ? '账号已保存，登录和会员状态将自动更新' : '名称已更新');
}
async function changeAccount(work, invalidate = true) {
    accounts.stop();
    try {
        await work();
    } finally {
        if (invalidate) resetCatalog();
        if (state.view === 'settings') await credentials();
    }
}
function editCredential(id) {
    const current = state.credentials.find((item) => item.credential_id === id);
    state.credentialId = current?.credential_id || '';
    if (current) {
        state.credentialSource = current.source;
        state.credentialProfile = current.auth_profile;
    }
    render();
    const cookie = root.querySelector('#cookie');
    if (cookie) cookie.value = '';
    const label = root.querySelector('#credential-label');
    if (label) label.value = current?.label || '';
    cookie?.focus();
}
function closeMenu() {
    document.querySelector('.context-menu')?.remove();
}
function menu(task, x, y) {
    closeMenu();
    if (!state.taskSelected.has(task.task_id)) {
        state.taskSelected = new Set([task.task_id]);
        render();
    }
    const selected = tasks.items.filter((t) => state.taskSelected.has(t.task_id));
    const element = document.createElement('div');
    element.className = 'context-menu';
    element.setAttribute('role', 'menu');
    element.innerHTML = [
        ['cancel', '取消任务'],
        ['retry', '重试任务'],
        ['hide', '移除记录'],
    ]
        .map(([action, label]) =>
            button(
                `task-${action}`,
                label,
                !selected.some((t) => canTaskAction(t, action)),
                'role="menuitem"',
            ),
        )
        .join('');
    root.append(element);
    element.style.left = `${Math.max(8, Math.min(x, innerWidth - 170))}px`;
    element.style.top = `${Math.max(8, Math.min(y, innerHeight - 135))}px`;
    element.querySelector('button:not(:disabled)')?.focus();
}
async function safely(work) {
    if (state.busy) return;
    state.busy = true;
    render();
    try {
        await work();
    } catch (error) {
        if (error.name !== 'AbortError') announce(error.message || '操作失败，请重试');
    } finally {
        state.busy = false;
        render();
    }
}
async function runView(work) {
    try {
        await work();
    } catch (error) {
        if (error.name !== 'AbortError') announce(error.message || '加载失败');
    }
}
root.addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.target.id === 'search-form') void runView(search);
    if (event.target.id === 'credential-form') void safely(saveCredential);
});
root.addEventListener('input', (event) => {
    if (event.target.id === 'query') state.query = event.target.value;
});
root.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.select) {
        target.checked
            ? state.selected.add(target.dataset.select)
            : state.selected.delete(target.dataset.select);
        render();
        return;
    }
    if (target.dataset.taskSelect) {
        target.checked
            ? state.taskSelected.add(target.dataset.taskSelect)
            : state.taskSelected.delete(target.dataset.taskSelect);
        render();
        return;
    }
    if (target.id === 'select-all') {
        state.selected = new Set(
            target.checked
                ? catalog.items
                      .filter((item) =>
                          supports(
                              state.providers.find((p) => p.source === item.ref?.source),
                              'resolve_audio',
                          ),
                      )
                      .map(identity)
                : [],
        );
        render();
        return;
    }
    if (target.id === 'select-tasks') {
        state.taskSelected = new Set(
            target.checked ? visibleTasks().map((task) => task.task_id) : [],
        );
        render();
        return;
    }
    if (target.id === 'source') {
        state.source = target.value;
        resetCatalog();
        void runView(loadCatalog);
    }
    if (target.id === 'credential-source') {
        state.credentialSource = target.value;
        state.credentialProfile = '';
        editCredential('');
    }
    if (target.id === 'credential-profile') state.credentialProfile = target.value;
    const setting = {
        quality: 'quality',
        'quality-policy': 'qualityPolicy',
        destination: 'destination',
    }[target.id];
    if (setting) {
        const value = target.value;
        if (state.busy) {
            render();
            return;
        }
        void safely(async () => {
            const settings = { ...state.settings, [setting]: value };
            await persist({ settings });
            state.settings = settings;
        });
    }
});
root.addEventListener('click', (event) => {
    const open = event.target.closest('[data-open]');
    const target = event.target.closest('[data-action]');
    if (open && !open.disabled) {
        void runView(() =>
            openItem(catalog.items.find((item) => identity(item) === open.dataset.open)),
        );
        return;
    }
    if (!target || target.disabled) return;
    const [action, ...parts] = target.dataset.action.split(':'),
        value = parts.join(':');
    closeMenu();
    if (action === 'menu') {
        const bounds = target.getBoundingClientRect();
        menu(tasks.get(value), bounds.left, bounds.bottom);
        return;
    }
    const dispatch = [
        'preview',
        'switch-preview',
        'stop-preview',
        'nav',
        'type',
        'filter',
        'back',
        'open',
        'artist-tab',
        'refresh-tasks',
        'load-more',
    ].includes(action)
        ? runView
        : safely;
    void dispatch(async () => {
        if (['preview', 'switch-preview', 'stop-preview'].includes(action)) {
            clearTimeout(toastTimer);
            state.toast = '';
        }
        if (action === 'restart') {
            location.reload();
            return;
        }
        if (action === 'nav') await navigate(value);
        if (action === 'type') {
            state.type = value;
            resetCatalog();
            if (
                state.source !== 'all' &&
                !availableSources().some((p) => p.source === state.source)
            )
                state.source = 'all';
            await loadCatalog();
        }
        if (action === 'filter') {
            state.taskFilter = value;
            state.taskSelected.clear();
            lastSelected = -1;
            state.taskTop = 0;
            const viewport = root.querySelector('.viewport');
            if (viewport) viewport.scrollTop = 0;
            render();
        }
        if (action === 'refresh-tasks') await resetTasks();
        if (action === 'load-more' && state.view !== 'downloads') await catalog.load();
        if (action === 'open')
            await openItem(catalog.items.find((item) => identity(item) === value));
        if (action === 'back') {
            const previous = state.trail.pop();
            state.detail = previous?.detail || null;
            state.selected = previous?.selected || new Set();
            state.top = previous?.top || 0;
            if (previous) catalog.restore(previous.page);
            else await loadCatalog();
        }
        if (action === 'artist-tab') {
            state.detail.kind =
                state.detail.kind === 'artists-albums' ? 'artists' : 'artists-albums';
            await loadCatalog();
        }
        if (action === 'download')
            await enqueue(catalog.items.filter((item) => identity(item) === value));
        if (action === 'download-selected') await enqueue(selectedItems());
        if (action === 'recover-submission') {
            await submission.confirm();
            announce('提交结果已确认');
        }
        if (action === 'preview')
            await player.play(
                catalog.items.find((item) => identity(item) === value),
                displayName(catalog.items.find((item) => identity(item) === value)),
            );
        if (action === 'stop-preview') {
            player?.stop();
            render();
        }
        if (action === 'switch-preview') await player.switchSource();
        if (action === 'open-folder') await openDownloads(session.downloads);
        if (action === 'pause-queue') {
            const { data } = await api.request('/admin/download-policy', {
                method: 'PATCH',
                body: { paused: !state.paused },
            });
            state.paused = data.paused;
        }
        if (['cancel', 'retry', 'hide'].includes(action)) await taskAction(action, [value]);
        if (action.startsWith('task-')) await taskAction(action.slice(5), [...state.taskSelected]);
        if (action.startsWith('credential-')) {
            const credential = state.credentials.find((c) => c.credential_id === value);
            if (action === 'credential-edit' || action === 'credential-new') {
                editCredential(value);
                return;
            }
            if (action === 'credential-refresh') {
                await credentials();
                return;
            }
            if (!credential) return;
            if (action === 'credential-verify') {
                await changeAccount(
                    () =>
                        api.request(`/credentials/${encodeURIComponent(value)}/verify`, {
                            method: 'POST',
                        }),
                    false,
                );
            }
            if (action === 'credential-cancel' && credential.verification?.id)
                await changeAccount(
                    () =>
                        api.request(
                            `/credentials/${encodeURIComponent(value)}/verify/${encodeURIComponent(credential.verification.id)}/cancel`,
                            { method: 'POST' },
                        ),
                    false,
                );
            if (
                action === 'credential-disable' &&
                (!credential.enabled ||
                    confirm('停用会清除该账号的 Cookie，再次启用需重新填写。继续？'))
            )
                await changeAccount(() =>
                    api.request(`/credentials/${encodeURIComponent(value)}/disable`, {
                        method: 'POST',
                    }),
                );
            if (action === 'credential-delete' && confirm('删除此凭据？'))
                await changeAccount(() =>
                    api.request(`/credentials/${encodeURIComponent(value)}`, {
                        method: 'DELETE',
                    }),
                );
            if (
                state.credentialId &&
                !state.credentials.some((item) => item.credential_id === state.credentialId)
            )
                editCredential('');
        }
    });
});
root.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('[data-task]');
    if (!row) return;
    event.preventDefault();
    menu(tasks.get(row.dataset.task), event.clientX, event.clientY);
});
document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.context-menu,[data-action^="menu:"]')) closeMenu();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeMenu();
        player?.stop();
        render();
    }
    if (event.target.closest('input,textarea,select') || state.view !== 'downloads') return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        state.taskSelected = new Set(visibleTasks().map((task) => task.task_id));
        render();
    }
    if (event.key === 'Delete') {
        event.preventDefault();
        void safely(() => taskAction('hide', [...state.taskSelected]));
    }
});
root.addEventListener('click', (event) => {
    const checkbox = event.target.closest('[data-task-select]');
    if (!checkbox) return;
    const items = visibleTasks(),
        index = items.findIndex((task) => task.task_id === checkbox.dataset.taskSelect);
    if (event.shiftKey && lastSelected >= 0)
        for (const task of items.slice(
            Math.min(index, lastSelected),
            Math.max(index, lastSelected) + 1,
        ))
            state.taskSelected.add(task.task_id);
    lastSelected = index;
});
root.addEventListener(
    'scroll',
    (event) => {
        if (!event.target.matches('.viewport')) return;
        const viewport = event.target,
            downloads = state.view === 'downloads';
        state[downloads ? 'taskTop' : 'top'] = viewport.scrollTop;
        state.height = viewport.clientHeight;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            updateHTML(viewport, listHTML(downloads));
            if (
                !downloads &&
                viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 240 &&
                catalog.hasMore &&
                !catalog.error
            )
                void catalog.load();
        });
    },
    true,
);
new ResizeObserver(() => {
    const viewport = root.querySelector('.viewport');
    if (viewport && Math.abs(state.height - viewport.clientHeight) > 1) {
        state.height = viewport.clientHeight;
        updateHTML(viewport, listHTML(state.view === 'downloads'));
    }
}).observe(root);
async function start() {
    render();
    try {
        session = await bootService();
        api = new Api(session);
        accounts = new Accounts(api, () => {
            state.credentials = accounts.items;
            if (state.view === 'settings') render();
        });
        const saved = await readPreferences();
        Object.assign(state.settings, saved.settings || {});
        state.hidden = new Set(saved.hidden || []);
        state.names = saved.names || {};
        submission = new DownloadSubmission(api, persist, saved.pending || null);
        player = new Preview(api, render, announce);
        taskSync = new TaskSync(api, tasks, render);
        const [providers, destinations, policy] = await Promise.all([
            api.request('/providers', { query: { limit: 100 } }),
            api.request('/destinations'),
            api.request('/admin/download-policy'),
        ]);
        state.providers = sortProviders(providers.data.items);
        state.destinations = destinations.data.items;
        state.paused = policy.data.paused;
        if (
            !state.destinations.some(
                (d) =>
                    d.destination_id === state.settings.destination &&
                    d.available &&
                    d.accept_new_tasks,
            )
        )
            state.settings.destination =
                state.destinations.find((d) => d.available && d.accept_new_tasks)?.destination_id ||
                '';
        state.ready = true;
        render();
        stopWatch = watchTasks(
            api,
            synchronizeTasks,
            (message) => {
                if (state.syncError !== message) {
                    state.syncError = message;
                    render();
                }
            },
            (event) => taskSync.receive(event),
        );
    } catch (error) {
        state.startupError = error.message || '本机服务启动失败';
        render();
    }
}
window.addEventListener('beforeunload', () => {
    tasks.controller.abort();
    accounts?.stop();
    stopWatch?.();
    player?.stop();
});
void start();
