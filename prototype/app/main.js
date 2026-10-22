import { init, os, storage } from '@neutralinojs/lib';
import { tracks, collections, collectionTracks } from './data.js';
import {
    addToQueue,
    advanceQueue,
    changeTask,
    defaults,
    isPending,
    readSettings,
    readStored,
    restoreTasks,
} from './queue.js';
import { updateHTML } from './dom.js';
import { appHTML } from './views.js';
import { createMotion } from './motion.js';
import './styles.css';

const native = 'NL_OS' in window;
if (native) init();
const root = document.getElementById('root');
const animateChanges = createMotion(root);
const cleanHistory = (value) =>
    Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, 5) : [];
const state = {
    view: 'search',
    search: '',
    query: '',
    searchType: 'tracks',
    source: '全部来源',
    collection: null,
    selected: new Set(),
    settings: readSettings(readStored('shiyin.settings.v1', defaults)),
    tasks: restoreTasks(readStored('shiyin.tasks.v1', [])),
    history: cleanHistory(readStored('shiyin.history.v1', [])),
    queueExpanded: false,
    downloadTab: '进行中',
    toast: '',
    directoryDialog: false,
    directoryDraft: '',
    preview: null,
    previewSeconds: 0,
    previewPlaying: false,
};
let ready = !native;
let audio = null;
let toastTimer;
let modalOpener;
const writes = new Map();
const saved = new Map();

function derived() {
    const active = state.tasks.filter(isPending);
    const running = state.tasks.filter((t) => t.status === 'downloading');
    const match = (text) => text.toLocaleLowerCase().includes(state.query.toLocaleLowerCase());
    const resultTracks = state.query
        ? tracks.filter(
              (t) =>
                  match(`${t.title} ${t.artist} ${t.album}`) &&
                  (state.source === '全部来源' || t.source === state.source),
          )
        : [];
    const resultCollections = state.query
        ? collections.filter(
              (c) =>
                  c.kind === (state.searchType === 'playlists' ? 'playlist' : 'album') &&
                  (match(`${c.title} ${c.subtitle} ${c.tag}`) ||
                      collectionTracks(c).some((t) => match(`${t.artist} ${t.title}`))) &&
                  (state.source === '全部来源' ||
                      collectionTracks(c).some((t) => t.source === state.source)),
          )
        : [];
    const shownTracks = state.collection ? collectionTracks(state.collection) : resultTracks;
    const showingTracks = !!state.collection || state.searchType === 'tracks';
    const resultIds = (showingTracks ? shownTracks : resultCollections).map((t) => t.id);
    const unique = (items) => [
        ...new Map(items.flatMap(collectionTracks).map((t) => [t.id, t])).values(),
    ];
    return {
        active,
        running,
        completed: state.tasks.filter((t) => t.status === 'completed'),
        failed: state.tasks.filter((t) => t.status === 'failed'),
        totalSpeed: running.reduce((sum, t) => sum + t.speed, 0),
        allPaused: active.length > 0 && active.every((t) => t.status === 'paused'),
        resultCollections,
        shownTracks,
        showingTracks,
        resultIds,
        allSelected: resultIds.length > 0 && resultIds.every((id) => state.selected.has(id)),
        selectedTracks: showingTracks
            ? shownTracks.filter((t) => state.selected.has(t.id))
            : unique(resultCollections.filter((c) => state.selected.has(c.id))),
        allResultTracks: showingTracks ? shownTracks : unique(resultCollections),
    };
}

function render() {
    updateHTML(root, appHTML(state, derived()));
    const modal = root.querySelector('.modal-backdrop');
    // Keep the background out of keyboard and accessibility navigation in the dialog.
    for (const child of root.firstElementChild.children)
        child.inert = (!!modal && child !== modal) || child.dataset.expanded === 'false';
    animateChanges(state);
    persist();
}

function persist() {
    if (!ready) return;
    for (const key of ['settings', 'tasks', 'history']) {
        const value = JSON.stringify(state[key]);
        if (saved.get(key) === value) continue;
        saved.set(key, value);
        try {
            localStorage.setItem(`shiyin.${key}.v1`, value);
        } catch {
            /* Native storage remains available. */
        }
        // Serialize per-key writes so a slow progress write cannot overwrite newer state.
        if (native)
            writes.set(
                key,
                (writes.get(key) ?? Promise.resolve())
                    .then(() => storage.setData(`${key}_v1`, value))
                    .catch(() => {
                        saved.delete(key);
                        if (key === 'settings') notify('设置未能保存到本机，请检查目录权限', false);
                    }),
            );
    }
}

function notify(text, save = true) {
    clearTimeout(toastTimer);
    state.toast = text;
    if (save) render();
    else updateHTML(root, appHTML(state, derived()));
    toastTimer = setTimeout(() => {
        state.toast = '';
        render();
    }, 3500);
}

function enqueue(songs) {
    const result = addToQueue(state.tasks, songs, state.settings);
    state.tasks = result.tasks;
    state.selected.clear();
    if (result.added) state.queueExpanded = true;
    notify(
        result.added
            ? `已加入 ${result.added} 首${result.skipped ? `，跳过 ${result.skipped} 首重复歌曲` : '，开始下载'}`
            : '已在队列中，或已下载',
    );
}

function search(value) {
    if (!value.trim()) {
        root.querySelector('#search-input')?.focus();
        return;
    }
    state.query = state.search = value.trim();
    state.collection = null;
    state.selected.clear();
    state.view = 'search';
    state.history = [state.query, ...state.history.filter((h) => h !== state.query)].slice(0, 5);
    render();
}

async function chooseDirectory() {
    if (native) {
        try {
            const path = await os.showFolderDialog('选择下载目录');
            if (path) {
                state.settings.directory = path;
                notify('下载目录已更新');
            }
        } catch {
            notify('无法打开文件夹选择器，请重试');
        }
    } else {
        modalOpener = document.activeElement;
        state.directoryDraft = state.settings.directory;
        state.directoryDialog = true;
        render();
        root.querySelector('#directory-input').focus();
    }
}

function closeDirectory() {
    state.directoryDialog = false;
    render();
    modalOpener?.focus();
}

async function openDirectory() {
    if (native) {
        try {
            await os.open(state.settings.directory);
        } catch {
            notify('无法打开目录，请在设置中重新选择');
        }
    } else {
        state.view = 'settings';
        notify('桌面端支持打开本地文件夹');
    }
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

async function playPreview(track) {
    if (!track?.previewUrl) {
        notify('这首歌暂时没有可用的试听音源');
        return;
    }
    if (state.preview?.id === track.id && audio) {
        if (state.previewPlaying) {
            audio.pause();
            state.previewPlaying = false;
            render();
        } else {
            const current = audio;
            try {
                await current.play();
                if (audio === current) {
                    state.previewPlaying = true;
                    render();
                }
            } catch {
                if (audio === current) notify('试听暂时不可用，请稍后重试');
            }
        }
        return;
    }
    stopPreview();
    const current = new Audio(track.previewUrl);
    audio = current;
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
        if (audio !== current) return;
        stopPreview();
        notify('试听音源不可用，请稍后重试');
    };
    state.preview = track;
    render();
    try {
        await current.play();
        if (audio === current) {
            state.previewPlaying = true;
            render();
        }
    } catch {
        if (audio === current) {
            stopPreview();
            notify('无法开始试听，请稍后重试');
        }
    }
}

root.addEventListener('click', (event) => {
    if (!ready) return;
    if (event.target.classList.contains('modal-backdrop')) {
        closeDirectory();
        return;
    }
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const { action, id } = target.dataset;
    switch (action) {
        case 'view':
            state.view = id;
            break;
        case 'settings':
            state.view = state.view === 'settings' ? 'search' : 'settings';
            break;
        case 'search-type':
            state.searchType = id;
            state.collection = null;
            state.selected.clear();
            break;
        case 'clear-search':
            state.search = '';
            render();
            root.querySelector('#search-input').focus();
            return;
        case 'history':
            search(id);
            return;
        case 'clear-history':
            state.history = [];
            break;
        case 'collection':
            state.collection = collections.find((c) => c.id === id);
            state.selected.clear();
            break;
        case 'back':
            state.collection = null;
            state.selected.clear();
            break;
        case 'download-track':
            enqueue(tracks.filter((t) => t.id === id));
            return;
        case 'download-collection':
            enqueue(collectionTracks(collections.find((c) => c.id === id)));
            return;
        case 'download-all':
            enqueue(derived().allResultTracks);
            return;
        case 'download-selected':
            enqueue(derived().selectedTracks);
            return;
        case 'download-tab':
            state.downloadTab = id;
            break;
        case 'pause':
        case 'resume':
        case 'retry':
        case 'remove':
            state.tasks = changeTask(state.tasks, id, action, state.settings);
            break;
        case 'toggle-all': {
            const allPaused = derived().allPaused;
            state.tasks = state.tasks.map((t) =>
                isPending(t) ? { ...t, status: allPaused ? 'queued' : 'paused', speed: 0 } : t,
            );
            break;
        }
        case 'clear-completed':
            state.tasks = state.tasks.map((t) =>
                t.status === 'completed' ? { ...t, historyHidden: true } : t,
            );
            notify('已清除完成记录');
            return;
        case 'collapse-queue':
            state.queueExpanded = false;
            render();
            root.querySelector('.status-download').focus({ preventScroll: true });
            return;
        case 'status':
            if (state.view === 'downloads') state.view = 'search';
            else if (derived().active.length) state.queueExpanded = !state.queueExpanded;
            else state.view = 'downloads';
            break;
        case 'toggle-setting':
            state.settings[id] = !state.settings[id];
            break;
        case 'concurrency':
            state.settings.concurrency = Math.max(
                1,
                Math.min(8, state.settings.concurrency + Number(id)),
            );
            break;
        case 'reset-settings':
            state.settings = { ...defaults, directory: state.settings.directory };
            notify('已恢复默认设置，下载目录保留');
            return;
        case 'choose-directory':
            void chooseDirectory();
            return;
        case 'open-directory':
            void openDirectory();
            return;
        case 'close-directory':
            closeDirectory();
            return;
        case 'close-toast':
            state.toast = '';
            clearTimeout(toastTimer);
            break;
        case 'preview':
            void playPreview(tracks.find((t) => t.id === id) ?? state.preview);
            return;
        case 'stop-preview':
            stopPreview();
            return;
    }
    render();
});

root.addEventListener('input', (event) => {
    if (!ready) return;
    if (event.target.id === 'search-input') state.search = event.target.value;
    else if (event.target.id === 'directory-input') state.directoryDraft = event.target.value;
    else return;
    render();
});

root.addEventListener('change', (event) => {
    if (!ready) return;
    const target = event.target;
    if (target.dataset.setting) state.settings[target.dataset.setting] = target.value;
    else if (target.id === 'source') {
        state.source = target.value;
        state.selected.clear();
    } else if (target.hasAttribute('data-select-all'))
        state.selected = target.checked ? new Set(derived().resultIds) : new Set();
    else if (target.dataset.select) {
        if (target.checked) state.selected.add(target.dataset.select);
        else state.selected.delete(target.dataset.select);
    } else return;
    render();
});

root.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!ready) return;
    if (event.target.dataset.form === 'search') search(state.search);
    else if (event.target.dataset.form === 'directory' && state.directoryDraft.trim()) {
        state.settings.directory = state.directoryDraft.trim();
        closeDirectory();
        notify('下载目录已更新');
    }
});

window.addEventListener('keydown', (event) => {
    if (state.directoryDialog) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDirectory();
        }
        if (event.key === 'Tab') {
            const elements = [
                ...root.querySelectorAll('.modal button:not(:disabled), .modal input'),
            ];
            const first = elements[0],
                last = elements.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
        return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        state.view = 'search';
        render();
        root.querySelector('#search-input').focus();
    }
});

async function start() {
    if (native) {
        const read = async (key) => {
            try {
                return JSON.parse(await storage.getData(key));
            } catch {
                return null;
            }
        };
        const [settings, tasks, history, path] = await Promise.all([
            read('settings_v1'),
            read('tasks_v1'),
            read('history_v1'),
            os.getPath('music').catch(() => defaults.directory),
        ]);
        state.settings = readSettings(settings);
        if (state.settings.directory === defaults.directory) state.settings.directory = path;
        state.tasks = restoreTasks(tasks);
        state.history = cleanHistory(history);
        ready = true;
    }
    render();
    root.querySelector('#search-input')?.focus();
    setInterval(() => {
        if (!state.tasks.some((t) => ['queued', 'downloading'].includes(t.status))) return;
        state.tasks = advanceQueue(state.tasks, state.settings.concurrency, 0.6);
        render();
    }, 600);
}
void start();
