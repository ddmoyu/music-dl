// Animate navigation, not routine renders (typing, selection and progress ticks).
// Web Animations keeps temporary styles separate from the DOM patcher.
export function createMotion(root) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let previous;
    let animation;
    reduced.addEventListener('change', () => {
        if (reduced.matches) animation?.cancel();
    });
    return (state) => {
        const current = {
            view: state.view,
            search: JSON.stringify([
                state.query,
                state.searchType,
                state.source,
                state.collection?.id,
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
        if (!selector) return;
        animation?.cancel();
        if (reduced.matches) return;
        animation = root.querySelector(selector)?.animate?.(
            [
                { opacity: 0.65, transform: 'translateY(3px)' },
                { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
        // Rapid navigation intentionally cancels the preceding transition.
        animation?.finished.catch(() => {});
    };
}
