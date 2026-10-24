import { init, storage } from '@neutralinojs/lib';
import {
    prepareCatalog,
    trackById,
    collectionById,
    artistById,
    tracksForCollection,
    parseLink,
} from './catalog.js';
import {
    providers,
    providerById,
    canSelectTrack,
    supportsCatalogMode,
    catalogModes,
} from './providers.js';
import {
    addToQueue,
    advanceQueue,
    changeTask,
    defaults,
    isPending,
    readSettings,
    readStored,
    restoreTasks,
    WORKERS,
} from './queue.js';
import { PagedResults, virtualWindow, ROW_HEIGHT, TASK_HEIGHT } from './virtual.js';
import { updateHTML } from './dom.js';
import { appHTML, listHTML } from './views.js';
import { canTaskAction, applyTaskAction } from './task-actions.js';
import { createMotion } from './motion.js';
import { cookieProviders, parseCookie } from './cookies.js';
import './styles.css';

const native = 'NL_OS' in window;
if (native) init();
const root = document.getElementById('root');
const animate = createMotion(root);
const cleanHistory = (value) =>
    Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, 5) : [];
const state = {
    view: 'search',
    search: '',
    query: '',
    searchType: 'tracks',
    source: 'all',
    catalogMode: 'search',
    collection: null,
    artist: null,
    artistTab: 'tracks',
    linkTrack: null,
    selected: new Map(),
    settings: readSettings(readStored('shiyin.settings.v1', defaults)),
    tasks: restoreTasks(readStored('shiyin.tasks.v1', [])),
    history: cleanHistory(readStored('shiyin.history.v1', [])),
    queueExpanded: false,
    downloadTab: '进行中',
    batchFilter: 'all',
    admissionPaused: false,
    taskSelected: new Set(),
    taskMenu: null,
    taskDelete: null,
    taskBusy: false,
    viewport: { top: 0, height: 400 },
    notices: [],
    toast: '',
    cookies: {},
    cookieDialog: null,
    cookieDraft: '',
    cookieVisible: false,
    cookieError: '',
    linkDialog: false,
    linkDraft: '',
    linkError: '',
    linkResult: null,
    trackDetail: null,
    taskDetail: null,
    bulk: null,
    serviceDraft: '',
    serviceToken: '',
    serviceError: '',
    preview: null,
    previewPlaying: false,
    previewSeconds: 0,
};
state.serviceDraft = state.settings.serviceUrl;
let ready = !native;
let catalog = prepareCatalog({});
let toastTimer, frame, persistTimer, modalOpener, audio, observedScroll;
let taskSelectionAnchor,
    taskShiftClick = false;
let settingsReturnView = 'search';
let taskVersion = 0,
    taskCacheVersion = -1,
    taskCache;
const saved = new Map();
const writes = new Map();
// A bounded trail holds only visited list states, never credentials or task copies.
const catalogTrail = [];
const catalogContextKeys = [
    'search',
    'query',
    'searchType',
    'source',
    'catalogMode',
    'collection',
    'artist',
    'artistTab',
    'linkTrack',
];
const viewports = { search: state.viewport, downloads: { top: 0, height: 400 } };
state.pager = new PagedResults(() => {
    if (ready) render();
});

function tasksChanged() {
    taskVersion++;
    schedulePersist();
}
function derived() {
    // Queue indexing runs once per mutation, never once per visible row.
    if (taskCacheVersion !== taskVersion) {
        const active = [],
            completed = [],
            failed = [],
            canceled = [],
            running = [];
        const taskByTrack = new Map(),
            batches = new Map();
        for (const t of state.tasks) {
            if (isPending(t)) active.push(t);
            else if (t.status === 'completed' && !t.historyHidden) completed.push(t);
            else if (t.status === 'failed') failed.push(t);
            else if (t.status === 'canceled') canceled.push(t);
            if (isPending(t) && !['queued', 'waiting_retry', 'canceling'].includes(t.status))
                running.push(t);
            if (isPending(t) || t.status === 'completed') taskByTrack.set(t.track.id, t);
            if (t.batchId) batches.set(t.batchId, (batches.get(t.batchId) ?? 0) + 1);
        }
        taskCache = {
            active,
            completed,
            failed,
            canceled,
            running,
            taskByTrack,
            batches: [...batches].map(([id, count]) => ({ id, count })),
        };
        taskCacheVersion = taskVersion;
    }
    const tabTasks = {
        进行中: taskCache.active,
        已完成: taskCache.completed,
        失败: taskCache.failed,
        已取消: taskCache.canceled,
    }[state.downloadTab];
    const selectable =
        catalog.kind === 'artists'
            ? []
            : state.pager.items.filter(
                  (item) => item.kind !== 'track' || canSelectTrack(item, state.settings),
              );
    return {
        ...taskCache,
        kind: catalog.kind,
        canGoBack: catalogTrail.length > 0,
        selectable,
        visibleTasks:
            state.batchFilter === 'all'
                ? tabTasks
                : tabTasks.filter((t) => t.batchId === state.batchFilter),
        allSelected:
            selectable.length > 0 && selectable.every((item) => state.selected.has(item.id)),
    };
}
function syncScroll() {
    const element = root.querySelector('.virtual-scroll');
    if (element !== observedScroll) {
        resizeObserver?.disconnect();
        observedScroll = element;
        if (!element) return;
        element.scrollTop = state.viewport.top;
        resizeObserver?.observe(element);
    }
    // Recheck after page appends and layout changes, including a viewport taller
    // than one page. Loading guards prevent render/resize from duplicating requests.
    if (element) scheduleScroll();
}
function render() {
    if (!ready) return;
    let d = derived();
    if (state.batchFilter !== 'all' && !d.batches.some((batch) => batch.id === state.batchFilter)) {
        state.batchFilter = 'all';
        d = derived();
    }
    const visibleIds = new Set(d.visibleTasks.map((task) => task.id));
    for (const id of state.taskSelected) if (!visibleIds.has(id)) state.taskSelected.delete(id);
    updateHTML(root, appHTML(state, d));
    const taskAll = root.querySelector('[data-task-select-all]');
    if (taskAll)
        taskAll.indeterminate =
            state.taskSelected.size > 0 && state.taskSelected.size < d.visibleTasks.length;
    for (const [id, value] of [
        ['cookie-input', state.cookieDraft],
        ['service-token', state.serviceToken],
    ]) {
        const input = root.querySelector(`#${id}`);
        if (input && input.value !== value) input.value = value;
    }
    for (const input of root.querySelectorAll('[data-select-all]'))
        input.indeterminate = state.selected.size > 0 && !derived().allSelected;
    const modal = root.querySelector('.modal-backdrop');
    for (const child of root.firstElementChild.children)
        child.inert = (!!modal && child !== modal) || child.dataset.expanded === 'false';
    animate(state);
    syncScroll();
}
const resizeObserver =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => scheduleScroll()) : null;
function scheduleScroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = null;
        const element = root.querySelector('.virtual-scroll');
        if (!element) return;
        const d = derived();
        const count = state.view === 'downloads' ? d.visibleTasks.length : state.pager.items.length;
        const rowHeight = state.view === 'downloads' ? TASK_HEIGHT : ROW_HEIGHT;
        const before = virtualWindow(count, state.viewport.top, state.viewport.height, rowHeight);
        Object.assign(state.viewport, {
            top: element.scrollTop,
            height: element.clientHeight || 400,
        });
        const after = virtualWindow(count, state.viewport.top, state.viewport.height, rowHeight);
        if (before.start !== after.start || before.end !== after.end)
            updateHTML(element.querySelector('.virtual-content'), listHTML(state, d));
        if (
            state.view === 'search' &&
            !state.pager.loading &&
            !state.pager.error &&
            element.scrollTop + state.viewport.height >=
                state.pager.items.length * ROW_HEIGHT - ROW_HEIGHT * 5
        )
            void state.pager.load();
    });
}
root.addEventListener(
    'scroll',
    (event) => {
        if (event.target.classList?.contains('virtual-scroll')) {
            if (state.taskMenu) closeTaskMenu(false);
            scheduleScroll();
        }
    },
    true,
);
window.addEventListener('resize', () => {
    if (state.taskMenu) closeTaskMenu(false);
    scheduleScroll();
});
function resetScroll() {
    state.viewport.top = 0;
    const element = root.querySelector('.virtual-scroll');
    if (element) element.scrollTop = 0;
}
function refreshCatalog() {
    state.selected.clear();
    viewports.search.top = 0;
    if (state.view === 'search') resetScroll();
    catalog = prepareCatalog({
        query: state.query,
        type: state.searchType,
        source: state.source,
        mode: state.catalogMode,
        cookies: state.cookies,
        artist: state.artist,
        artistTab: state.artistTab,
        collection: state.collection,
        linkTrack: state.linkTrack,
    });
    state.notices = catalog.notices;
    return state.pager
        .reset(catalog.items.length ? catalog.fetchPage : null, catalog.items.length)
        .then(() => render());
}
function persist() {
    if (!ready) return;
    clearTimeout(persistTimer);
    persistTimer = null;
    // Secret drafts, Cookie values, service tokens and viewport state are excluded.
    for (const key of ['settings', 'tasks', 'history']) {
        const value = JSON.stringify(state[key]);
        if (saved.get(key) === value) continue;
        saved.set(key, value);
        try {
            localStorage.setItem(`shiyin.${key}.v1`, value);
        } catch {
            saved.delete(key);
        }
        if (native)
            writes.set(
                key,
                (writes.get(key) ?? Promise.resolve())
                    .then(() => storage.setData(`${key}_v1`, value))
                    .catch(() => {
                        saved.delete(key);
                    }),
            );
    }
}
function schedulePersist() {
    if (!persistTimer) persistTimer = setTimeout(persist, 1800);
}
window.addEventListener('pagehide', persist);
function notify(message) {
    clearTimeout(toastTimer);
    state.toast = message;
    render();
    toastTimer = setTimeout(() => {
        state.toast = '';
        render();
    }, 3500);
}
function clearContext(discardTrail = true) {
    if (discardTrail) catalogTrail.length = 0;
    state.artist = state.collection = state.linkTrack = null;
    state.artistTab = 'tracks';
}
function rememberCatalog() {
    const element = root.querySelector('.results-scroll');
    const opener = document.activeElement?.closest('[data-action]');
    catalogTrail.push({
        context: Object.fromEntries(catalogContextKeys.map((key) => [key, state[key]])),
        catalog,
        pager: state.pager.snapshot(),
        selected: new Map(state.selected),
        viewport: { ...viewports.search, top: element?.scrollTop ?? viewports.search.top },
        opener: opener ? { action: opener.dataset.action, id: opener.dataset.id } : null,
    });
    if (catalogTrail.length > 12) catalogTrail.shift();
}
function backCatalog() {
    const saved = catalogTrail.pop();
    if (!saved) {
        clearContext();
        void refreshCatalog();
        return;
    }
    Object.assign(state, saved.context);
    catalog = saved.catalog;
    state.notices = catalog.notices;
    state.selected = new Map(
        [...saved.selected].filter(
            ([, item]) => item.kind !== 'track' || canSelectTrack(item, state.settings),
        ),
    );
    Object.assign(viewports.search, saved.viewport);
    state.viewport = viewports.search;
    state.pager.restore(saved.pager);
    const element = root.querySelector('.results-scroll');
    if (element) element.scrollTop = state.viewport.top;
    const opener = [...root.querySelectorAll('[data-action]')].find(
        (node) =>
            node.dataset.action === saved.opener?.action && node.dataset.id === saved.opener?.id,
    );
    (opener ?? element)?.focus({ preventScroll: true });
}
function search(value) {
    if (!value.trim()) return root.querySelector('#search-input')?.focus();
    if (/https?:\/\//i.test(value)) {
        openDialog();
        state.linkDialog = true;
        state.linkDraft = value;
        resolveLink();
        focusDialog();
        return;
    }
    state.search = state.query = value.trim();
    state.catalogMode = 'search';
    state.view = 'search';
    clearContext();
    state.history = [state.query, ...state.history.filter((item) => item !== state.query)].slice(
        0,
        5,
    );
    persist();
    void refreshCatalog();
}
function switchView(view) {
    state.taskMenu = null;
    if (view === state.view) return;
    const element = root.querySelector('.virtual-scroll');
    if (element) state.viewport.top = element.scrollTop;
    state.view = view;
    state.viewport = viewports[view] ?? { top: 0, height: 400 };
    render();
}
function openDialog() {
    modalOpener = document.activeElement;
}
function closeModal() {
    if (state.bulk?.running) {
        state.bulk.stopped = true;
        state.bulk.running = false;
    }
    state.cookieDialog = null;
    state.cookieDraft = '';
    state.cookieVisible = false;
    state.cookieError = '';
    state.linkDialog = false;
    state.linkDraft = '';
    state.linkError = '';
    state.linkResult = null;
    state.taskDelete = null;
    state.taskDetail = null;
    state.trackDetail = null;
    state.bulk = null;
    render();
    if (modalOpener?.isConnected) modalOpener.focus({ preventScroll: true });
    else
        root.querySelector('[data-task-select-all], .task-list, .downloads-heading button')?.focus({
            preventScroll: true,
        });
}
function focusDialog() {
    root.querySelector('.modal input, .modal button')?.focus();
}
function openCookie(id) {
    const p = cookieProviders.find((item) => item.id === id);
    if (!p) return;
    openDialog();
    modalOpener =
        root.querySelector(`[data-action="configure-cookie"][data-id="${id}"]`) ?? modalOpener;
    state.cookieDialog = p;
    state.cookieDraft = '';
    state.cookieError = '';
    state.cookieVisible = false;
    render();
    root.querySelector('#cookie-input')?.focus();
}
function openArtist(id) {
    const artist = artistById.get(id);
    if (!artist) return;
    if (state.artist?.id === id && !state.collection) return;
    rememberCatalog();
    if (!providerById.get(artist.source).artistTracks) {
        clearContext(false);
        state.source = artist.source;
        state.searchType = 'tracks';
        state.search = state.query = artist.title;
        state.catalogMode = 'search';
        void refreshCatalog();
        return;
    }
    state.artist = artist;
    state.collection = state.linkTrack = null;
    state.artistTab = 'tracks';
    state.view = 'search';
    void refreshCatalog();
}
function resolveLink() {
    const result = parseLink(state.linkDraft);
    state.linkError = result.error ?? '';
    state.linkResult = result.item ?? null;
    render();
}
function enqueue(tracks, options = state.settings) {
    const result = addToQueue(state.tasks, tracks, options);
    state.tasks = result.tasks;
    tasksChanged();
    persist();
    if (result.added) state.queueExpanded = true;
    notify(
        `加入 ${result.added} 首${result.skipped ? ` · 重复 ${result.skipped}` : ''}${result.unavailable ? ` · 不可用 ${result.unavailable}` : ''}${result.capacity ? ` · 队列已满，${result.capacity} 首未加入` : ''}`,
    );
}
function showBulk(items, title) {
    // Freeze selected entities; changes to later searches cannot change this job.
    const tracks = [
        ...new Map(
            items
                .flatMap((item) => (item.kind === 'track' ? [item] : tracksForCollection(item)))
                .map((item) => [item.id, item]),
        ).values(),
    ];
    if (!tracks.length) return;
    openDialog();
    state.bulk = {
        title,
        tracks,
        total: tracks.length,
        processed: 0,
        added: 0,
        skipped: 0,
        unavailable: 0,
        capacity: 0,
        running: false,
        done: false,
        options: { ...state.settings },
    };
    render();
    focusDialog();
}
async function runBulk() {
    const job = state.bulk;
    if (!job || job.running || job.done) return;
    job.running = true;
    render();
    while (job.processed < job.total && !job.stopped) {
        await new Promise((resolve) => setTimeout(resolve, 35));
        if (job.stopped || state.bulk !== job) return;
        const chunk = job.tracks.slice(job.processed, job.processed + 100);
        const result = addToQueue(state.tasks, chunk, job.options);
        state.tasks = result.tasks;
        tasksChanged();
        for (const key of ['added', 'skipped', 'unavailable', 'capacity']) job[key] += result[key];
        job.processed += chunk.length;
        render();
    }
    job.running = false;
    job.done = true;
    state.selected.clear();
    persist();
    render();
}
function stopPreview() {
    if (audio) {
        audio.pause();
        audio.ontimeupdate = audio.onended = audio.onerror = null;
        audio = null;
    }
    state.preview = null;
    state.previewPlaying = false;
    state.previewSeconds = 0;
    render();
}
async function preview(track) {
    if (!track?.previewUrl) return notify('这首歌暂时没有可用的试听音源');
    if (audio && state.preview?.id === track.id) {
        if (state.previewPlaying) {
            audio.pause();
            state.previewPlaying = false;
            render();
            return;
        }
        try {
            await audio.play();
            state.previewPlaying = true;
            render();
        } catch {
            notify('无法开始试听，请稍后重试');
        }
        return;
    }
    stopPreview();
    const current = new Audio(track.previewUrl);
    audio = current;
    state.preview = track;
    current.volume = 0.5;
    current.ontimeupdate = () => {
        if (audio !== current) return;
        state.previewSeconds = Math.floor(current.currentTime);
        if (current.currentTime >= 30) stopPreview();
        else render();
    };
    current.onended = () => {
        if (audio === current) stopPreview();
    };
    current.onerror = () => {
        if (audio === current) {
            stopPreview();
            notify('试听音源不可用');
        }
    };
    try {
        await current.play();
        if (audio === current) {
            state.previewPlaying = true;
            render();
        }
    } catch {
        if (audio === current) {
            stopPreview();
            notify('无法开始试听');
        }
    }
}

function taskMenuAnchor(id) {
    return [...root.querySelectorAll('[data-action="task-menu"]')].find(
        (el) => el.dataset.id === id,
    );
}
function closeTaskMenu(restoreFocus = true) {
    const id = state.taskMenu?.anchor;
    state.taskMenu = null;
    render();
    if (restoreFocus)
        (taskMenuAnchor(id) ?? root.querySelector('.task-list, .downloads-heading button'))?.focus({
            preventScroll: true,
        });
}
function openTaskMenu(id, x, y) {
    if (state.view !== 'downloads' || root.querySelector('[role="dialog"]')) return;
    if (!derived().visibleTasks.some((task) => task.id === id)) return;
    if (!state.taskSelected.has(id)) state.taskSelected = new Set([id]);
    const selected = state.tasks.filter((t) => state.taskSelected.has(t.id));
    const actions = ['cancel', 'retry', 'redownload'].filter((action) =>
        selected.some((t) => canTaskAction(t, action)),
    );
    state.taskMenu = { anchor: id, ids: [...state.taskSelected], actions, x, y };
    render();
    const menu = root.querySelector('.task-context-menu');
    const rect = menu.getBoundingClientRect();
    const bounds = root.querySelector('.app-window').getBoundingClientRect();
    state.taskMenu.x = Math.max(
        bounds.left + 8,
        Math.min(x, (bounds.right || window.innerWidth) - rect.width - 8),
    );
    state.taskMenu.y = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    menu.style.left = state.taskMenu.x + 'px';
    menu.style.top = state.taskMenu.y + 'px';
    menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
function requestTaskDelete(ids) {
    if (state.taskBusy) return;
    const selected = new Set(ids);
    const removable = state.tasks.filter((t) => selected.has(t.id) && canTaskAction(t, 'delete'));
    if (!removable.length) return notify('运行中的任务请先取消，再删除记录');
    openDialog();
    state.taskDelete = removable.map((t) => t.id);
    render();
    focusDialog();
}
async function runTaskAction(ids, action) {
    if (state.taskBusy) return;
    if (action === 'delete') return requestTaskDelete(ids);
    state.taskBusy = true;
    const settings = { ...state.settings };
    let changed = 0,
        skipped = 0;
    try {
        // Yield between retry chunks so large selections do not block interaction.
        for (let offset = 0; offset < ids.length; offset += 20) {
            const result = applyTaskAction(
                state.tasks,
                ids.slice(offset, offset + 20),
                action,
                settings,
            );
            state.tasks = result.tasks;
            changed += result.changed;
            skipped += result.skipped;
            tasksChanged();
            render();
            if (offset + 20 < ids.length) await new Promise((resolve) => setTimeout(resolve, 0));
        }
    } finally {
        state.taskBusy = false;
    }
    persist();
    notify(
        `${action === 'cancel' ? '已取消或请求取消' : '已新建'} ${changed} 项${skipped ? `，跳过 ${skipped} 项（状态变化、重复、不可用或容量限制）` : ''}`,
    );
}
root.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('[data-task-row]');
    if (!row || root.querySelector('[role="dialog"]')) return;
    event.preventDefault();
    openTaskMenu(row.dataset.taskRow, event.clientX, event.clientY);
});
document.addEventListener('pointerdown', (event) => {
    if (!root.isConnected || !state.taskMenu) return;
    if (!event.target.closest('.task-context-menu, [data-action="task-menu"]'))
        closeTaskMenu(false);
});

root.addEventListener('click', (event) => {
    if (!ready) return;
    if (event.target.classList.contains('modal-backdrop')) return closeModal();
    if (event.target.matches('[data-task-select]')) taskShiftClick = event.shiftKey;
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const { action, id } = target.dataset;
    if (state.taskMenu && !['task-menu', 'task-menu-action'].includes(action)) closeTaskMenu();
    switch (action) {
        case 'view':
            return switchView(id);
        case 'settings':
            if (state.view === 'settings') return switchView(settingsReturnView);
            settingsReturnView = state.view;
            return switchView('settings');
        case 'search-type':
            if (state.searchType === id && !state.collection && !state.artist && !state.linkTrack)
                return;
            if (state.source !== 'all' && !providerById.get(state.source)?.types.includes(id))
                return;
            state.searchType = id;
            clearContext();
            void refreshCatalog();
            return;
        case 'catalog-mode':
            if (!Object.hasOwn(catalogModes, id)) return;
            if (state.view !== 'search' && state.catalogMode === id) return switchView('search');
            if (state.view !== 'search') switchView('search');
            if (!supportsCatalogMode(state.source, id))
                state.source = providers.find((provider) =>
                    supportsCatalogMode(provider.id, id),
                ).id;
            if (state.catalogMode === id && !state.collection && !state.artist && !state.linkTrack)
                return;
            state.catalogMode = id;
            clearContext();
            void refreshCatalog();
            return;
        case 'clear-search':
            state.search = '';
            render();
            root.querySelector('#search-input')?.focus();
            return;
        case 'history':
            return search(id);
        case 'clear-history':
            state.history = [];
            persist();
            break;
        case 'collection': {
            const item = collectionById.get(id);
            if (!item) return;
            rememberCatalog();
            state.collection = item;
            state.artist = state.linkTrack = null;
            void refreshCatalog();
            return;
        }
        case 'artist':
        case 'open-track-artist':
            return openArtist(id);
        case 'artist-tab':
            if (state.artistTab === id) return;
            state.artistTab = id;
            state.collection = null;
            void refreshCatalog();
            return;
        case 'back':
            return backCatalog();
        case 'load-more':
            void state.pager.load();
            return;
        case 'clear-selected':
            state.selected.clear();
            break;
        case 'download-track': {
            const track = trackById.get(id);
            if (track) enqueue([track]);
            return;
        }
        case 'download-collection': {
            const item = collectionById.get(id);
            if (item) showBulk([item], item.title);
            return;
        }
        case 'download-selected':
            showBulk([...state.selected.values()], '所选内容');
            return;
        case 'download-all':
            showBulk(
                state.collection || (state.artist && state.artistTab === 'tracks')
                    ? catalog.items
                    : state.pager.items,
                state.collection?.title ?? state.artist?.title ?? '已加载的结果',
            );
            return;
        case 'confirm-bulk':
            void runBulk();
            return;
        case 'stop-bulk':
            state.bulk.stopped = true;
            state.bulk.running = false;
            state.bulk.done = true;
            persist();
            break;
        case 'bulk-tasks':
            closeModal();
            return switchView('downloads');
        case 'download-tab':
            state.taskSelected.clear();
            taskSelectionAnchor = null;
            state.downloadTab = id;
            resetScroll();
            break;
        case 'toggle-admission':
            state.admissionPaused = !state.admissionPaused;
            break;
        case 'cancel':
        case 'retry':
        case 'redownload': {
            const old = state.tasks;
            state.tasks = changeTask(old, id, action, state.settings);
            tasksChanged();
            persist();
            if (['retry', 'redownload'].includes(action))
                notify(
                    state.tasks.length > old.length
                        ? '已创建新的下载任务'
                        : '未加入：任务已存在、资源不可用或队列已满',
                );
            break;
        }
        case 'cancel-batch':
            void runTaskAction(
                state.tasks.filter((t) => t.batchId === id && isPending(t)).map((t) => t.id),
                'cancel',
            );
            return;
        case 'task-menu': {
            if (state.taskMenu?.anchor === id) return closeTaskMenu();
            const rect = target.getBoundingClientRect();
            return openTaskMenu(id, rect.left, rect.bottom + 4);
        }
        case 'task-menu-action': {
            const ids = state.taskMenu?.ids ?? [];
            closeTaskMenu();
            void runTaskAction(ids, id);
            return;
        }
        case 'task-bulk-action':
            void runTaskAction([...state.taskSelected], id);
            return;
        case 'task-clear-selection':
            state.taskSelected.clear();
            break;
        case 'confirm-task-delete': {
            const result = applyTaskAction(
                state.tasks,
                state.taskDelete ?? [],
                'delete',
                state.settings,
            );
            state.tasks = result.tasks;
            tasksChanged();
            persist();
            closeModal();
            notify(`已删除 ${result.changed} 条任务记录，音乐文件保留`);
            return;
        }
        case 'collapse-queue':
            state.queueExpanded = false;
            break;
        case 'status':
            if (state.view === 'downloads') return switchView('search');
            if (derived().active.length) state.queueExpanded = !state.queueExpanded;
            else return switchView('downloads');
            break;
        case 'toggle-setting':
            state.settings[id] = !state.settings[id];
            if (id === 'allowPreview')
                for (const [key, item] of state.selected)
                    if (item.kind === 'track' && !canSelectTrack(item, state.settings))
                        state.selected.delete(key);
            persist();
            break;
        case 'reset-settings':
            state.settings = { ...defaults, serviceUrl: state.settings.serviceUrl };
            persist();
            break;
        case 'configure-cookie':
            return openCookie(id);
        case 'reveal-cookie':
            state.cookieVisible = !state.cookieVisible;
            break;
        case 'clear-cookie':
            if (state.cookieDialog) delete state.cookies[state.cookieDialog.id];
            catalogTrail.length = 0;
            closeModal();
            void refreshCatalog();
            return;
        case 'open-link-result': {
            const item = state.linkResult;
            closeModal();
            rememberCatalog();
            clearContext(false);
            if (item.kind === 'track') state.linkTrack = item;
            else state.collection = item;
            state.view = 'search';
            state.source = item.source;
            state.catalogMode = 'search';
            void refreshCatalog();
            return;
        }
        case 'track-detail':
            openDialog();
            state.trackDetail = trackById.get(id);
            render();
            focusDialog();
            return;
        case 'task-detail':
            openDialog();
            state.taskDetail = id;
            render();
            focusDialog();
            return;
        case 'close-modal':
            return closeModal();
        case 'close-toast':
            state.toast = '';
            clearTimeout(toastTimer);
            break;
        case 'preview':
            void preview(trackById.get(id) ?? state.preview);
            return;
        case 'stop-preview':
            return stopPreview();
    }
    render();
});
root.addEventListener('input', (event) => {
    const { id, value } = event.target;
    if (id === 'search-input') {
        state.search = value;
        return;
    }
    if (id === 'service-token') {
        state.serviceToken = value;
        return;
    }
    if (id === 'service-url') {
        state.serviceDraft = value;
        return;
    }
    if (id === 'cookie-input') {
        state.cookieDraft = value;
        state.cookieError = '';
    } else if (id === 'link-input') {
        state.linkDraft = value;
        state.linkError = '';
        state.linkResult = null;
    } else return;
    render();
});
root.addEventListener('change', (event) => {
    const target = event.target;
    if (target.id === 'source') {
        if (state.source === target.value) return;
        const restoreSourceFocus = document.activeElement === target;
        state.source = target.value;
        if (!supportsCatalogMode(state.source, state.catalogMode)) state.catalogMode = 'search';
        if (
            state.source !== 'all' &&
            !providerById.get(state.source)?.types.includes(state.searchType)
        )
            state.searchType = 'tracks';
        clearContext();
        void refreshCatalog();
        if (restoreSourceFocus) root.querySelector('#source')?.focus({ preventScroll: true });
        return;
    }
    if (target.id === 'batch-filter') {
        state.taskSelected.clear();
        taskSelectionAnchor = null;
        state.batchFilter = target.value;
        resetScroll();
    } else if (target.hasAttribute('data-task-select-all')) {
        for (const task of derived().visibleTasks) {
            if (target.checked) state.taskSelected.add(task.id);
            else state.taskSelected.delete(task.id);
        }
    } else if (target.dataset.taskSelect) {
        const items = derived().visibleTasks;
        const index = items.findIndex((task) => task.id === target.dataset.taskSelect);
        const anchor = items.findIndex((task) => task.id === taskSelectionAnchor);
        const range =
            taskShiftClick && anchor >= 0
                ? items.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
                : items.slice(index, index + 1);
        for (const task of range) {
            if (target.checked) state.taskSelected.add(task.id);
            else state.taskSelected.delete(task.id);
        }
        taskShiftClick = false;
        taskSelectionAnchor = target.dataset.taskSelect;
    } else if (target.dataset.setting) {
        state.settings = readSettings({
            ...state.settings,
            [target.dataset.setting]: target.value,
        });
        persist();
    } else if (target.hasAttribute('data-select-all'))
        for (const item of derived().selectable) {
            if (target.checked) state.selected.set(item.id, item);
            else state.selected.delete(item.id);
        }
    else if (target.dataset.select) {
        const item = state.pager.items.find((x) => x.id === target.dataset.select);
        if (item && (item.kind !== 'track' || canSelectTrack(item, state.settings))) {
            if (target.checked) state.selected.set(item.id, item);
            else state.selected.delete(item.id);
        }
    } else return;
    render();
});
root.addEventListener('submit', (event) => {
    event.preventDefault();
    switch (event.target.dataset.form) {
        case 'search':
            return search(state.search);
        case 'link':
            return resolveLink();
        case 'cookie': {
            const result = parseCookie(state.cookieDraft);
            if (result.error) {
                state.cookieError = result.error;
                render();
                return;
            }
            state.cookies[state.cookieDialog.id] = result.value;
            catalogTrail.length = 0;
            closeModal();
            void refreshCatalog();
            notify('Cookie 已填写，尚未验证');
            return;
        }
        case 'service': {
            const parsed = readSettings({ ...state.settings, serviceUrl: state.serviceDraft });
            if (
                parsed.serviceUrl === defaults.serviceUrl &&
                state.serviceDraft.replace(/\/$/, '') !== defaults.serviceUrl
            ) {
                state.serviceError = '请输入不含账号、密码或查询参数的 HTTP(S) 服务地址';
                render();
                return;
            }
            state.settings = parsed;
            state.serviceDraft = parsed.serviceUrl;
            state.serviceError = '';
            persist();
            notify('连接设置已保存');
            return;
        }
    }
});
window.addEventListener('keydown', (event) => {
    if (!root.isConnected) return;
    const modal = root.querySelector('[role="dialog"]');
    if (modal) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeModal();
        }
        if (event.key === 'Tab') {
            const focusable = [
                ...modal.querySelectorAll('button:not(:disabled), input, select, summary'),
            ];
            const first = focusable[0],
                last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        }
        return;
    }
    if (state.taskMenu) {
        const buttons = [...root.querySelectorAll('.task-context-menu button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next =
                event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                        buttons.length;
            buttons[next]?.focus({ preventScroll: true });
        } else if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault();
            closeTaskMenu();
        }
        return;
    }
    if (state.view === 'downloads') {
        const focused = document.activeElement;
        const row = focused?.closest('[data-task-row]');
        if (row && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
            event.preventDefault();
            const rect = focused.getBoundingClientRect();
            openTaskMenu(row.dataset.taskRow, rect.left, rect.bottom + 4);
            return;
        }
        const editing = focused?.matches(
            'input:not([type="checkbox"]), textarea, select, [contenteditable="true"]',
        );
        if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            state.taskSelected = new Set(derived().visibleTasks.map((task) => task.id));
            render();
            return;
        }
        if (!editing && event.key === 'Delete' && state.taskSelected.size) {
            event.preventDefault();
            requestTaskDelete([...state.taskSelected]);
            return;
        }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        state.catalogMode = 'search';
        clearContext();
        void refreshCatalog();
        switchView('search');
        root.querySelector('#search-input')?.focus();
    }
});
async function start() {
    if (native) {
        const read = async (key) => {
            try {
                return JSON.parse(await storage.getData(`${key}_v1`));
            } catch {
                return null;
            }
        };
        const [settings, tasks, history] = await Promise.all(
            ['settings', 'tasks', 'history'].map(read),
        );
        state.settings = readSettings(settings);
        state.tasks = restoreTasks(tasks);
        state.history = cleanHistory(history);
        state.serviceDraft = state.settings.serviceUrl;
        taskVersion++;
        ready = true;
    }
    render();
    root.querySelector('#search-input')?.focus();
    setInterval(() => {
        if (!root.isConnected || !state.tasks.some(isPending)) return;
        state.tasks = advanceQueue(state.tasks, WORKERS, 0.6, state.admissionPaused);
        tasksChanged();
        render();
    }, 600);
}
void start();
