// Animate navigation, not routine renders (typing, selection and progress ticks).
// Web Animations keeps temporary styles separate from the DOM patcher.
export function createMotion(root) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let previous;
    let animation;
    let pendingSelector;
    reduced.addEventListener('change', () => {
        if (reduced.matches) {
            animation?.cancel();
            animation = null;
            pendingSelector = null;
        }
    });
    return (state) => {
        const current = {
            view: state.view,
            search: JSON.stringify([
                state.query,
                state.searchType,
                state.source,
                state.catalogMode,
                state.collection?.id,
                state.artist?.id,
                state.artistTab,
                state.linkTrack?.id,
            ]),
            tab: state.downloadTab,
        };
        let selector;
        if (previous) {
            if (previous.view !== current.view) selector = '.main-panel';
            else if (current.view === 'search' && previous.search !== current.search)
                selector = '.results-scroll, .empty-results';
            else if (current.view === 'downloads' && previous.tab !== current.tab)
                selector = '.task-list, .empty-results';
        }
        previous = current;
        if (selector) {
            animation?.cancel();
            animation = null;
            pendingSelector = selector;
        }
        if (!pendingSelector) return;
        if (reduced.matches) {
            pendingSelector = null;
            return;
        }
        // Let the first page arrive before fading in its contents. Later pages,
        // virtual row recycling and routine renders must not restart the effect.
        if (state.view === 'search' && state.pager?.loading && !state.pager.items.length) {
            pendingSelector = '.results-scroll, .empty-results';
            return;
        }
        const target = root.querySelector(pendingSelector);
        const offset = pendingSelector === '.main-panel' ? '0' : '2px';
        pendingSelector = null;
        animation = target?.animate?.(
            [
                { opacity: 0.84, transform: `translateY(${offset})` },
                { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
        // Rapid navigation intentionally cancels the preceding transition.
        const started = animation;
        animation?.finished.then(
            () => {
                if (animation === started) animation = null;
            },
            () => {},
        );
    };
}
