import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

// The web, window and executable icons share a single vector source.
const svg = await readFile(new URL('../public/favicon.svg', import.meta.url));
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng();
await mkdir(new URL('../dist/app/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/app/app-icon.png', import.meta.url), png);
console.log('曲袋图标已更新');
