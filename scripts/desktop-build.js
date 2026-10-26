import { hostTarget } from './desktop-targets.js';

const target = hostTarget();
if (target.platform === 'win32') await import('./desktop-build-windows.js');
else await import('./desktop-build-posix.js');
