// Lucide 0.468.0 SVG paths; license: ../public/licenses/lucide.txt
const icons = {
    MoreHorizontal:
        '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
    UserRound: '<circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 0 0-16 0"></path>',
    Link: '<path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2"></path><path d="M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2"></path>',
    ArrowDownToLine:
        '<path d="M12 17V3"></path><path d="m6 11 6 6 6-6"></path><path d="M19 21H5"></path>',
    ArrowLeft: '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>',
    ArrowRight: '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>',
    AudioLines:
        '<path d="M2 10v3"></path><path d="M6 6v11"></path><path d="M10 3v18"></path><path d="M14 8v7"></path><path d="M18 5v13"></path><path d="M22 10v3"></path>',
    Check: '<path d="M20 6 9 17l-5-5"></path>',
    CheckCheck: '<path d="M18 6 7 17l-5-5"></path><path d="m22 10-7.5 7.5L13 16"></path>',
    ChevronDown: '<path d="m6 9 6 6 6-6"></path>',
    ChevronRight: '<path d="m9 18 6-6-6-6"></path>',
    ChevronUp: '<path d="m18 15-6-6-6 6"></path>',
    Disc3: '<circle cx="12" cy="12" r="10"></circle><path d="M6 12c0-1.7.7-3.2 1.8-4.2"></path><circle cx="12" cy="12" r="2"></circle><path d="M18 12c0 1.7-.7 3.2-1.8 4.2"></path>',
    Download:
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line>',
    Folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>',
    ListMusic:
        '<path d="M21 15V6"></path><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"></path><path d="M12 12H3"></path><path d="M16 6H3"></path><path d="M12 18H3"></path>',
    LoaderCircle: '<path d="M21 12a9 9 0 1 1-6.219-8.56"></path>',
    Music2: '<circle cx="8" cy="18" r="4"></circle><path d="M12 18V2l7 4"></path>',
    Pause: '<rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"></rect>',
    Play: '<polygon points="6 3 20 12 6 21 6 3"></polygon>',
    Stop: '<rect x="6" y="6" width="12" height="12" rx="1"></rect>',
    Plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
    RotateCcw:
        '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path>',
    Search: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
    Settings2:
        '<path d="M20 7h-9"></path><path d="M14 17H5"></path><circle cx="17" cy="17" r="3"></circle><circle cx="7" cy="7" r="3"></circle>',
    SlidersHorizontal:
        '<line x1="21" x2="14" y1="4" y2="4"></line><line x1="10" x2="3" y1="4" y2="4"></line><line x1="21" x2="12" y1="12" y2="12"></line><line x1="8" x2="3" y1="12" y2="12"></line><line x1="21" x2="16" y1="20" y2="20"></line><line x1="12" x2="3" y1="20" y2="20"></line><line x1="14" x2="14" y1="2" y2="6"></line><line x1="8" x2="8" y1="10" y2="14"></line><line x1="16" x2="16" y1="18" y2="22"></line>',
    Trash2: '<path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" x2="10" y1="11" y2="17"></line><line x1="14" x2="14" y1="11" y2="17"></line>',
    X: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
};
export function icon(name, size = 15, className = '') {
    name =
        {
            music: 'AudioLines',
            settings: 'Settings2',
            search: 'Search',
            folder: 'Folder',
            download: 'Download',
            play: 'Play',
            stop: 'Stop',
            close: 'X',
        }[name] || name;
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        size +
        '" height="' +
        size +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="' +
        className +
        '">' +
        icons[name] +
        '</svg>'
    );
}
