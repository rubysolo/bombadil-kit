import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The report's two typefaces, embedded as base64 @font-face rules so the page
 * looks the same from file://, a CI artifact or a laptop without them
 * installed. Latin subsets from @fontsource (OFL; licences in ../fonts/).
 */
const FACES = [
  { family: 'Rajdhani', weight: 600, file: 'rajdhani-latin-600-normal.woff2' },
  { family: 'Rajdhani', weight: 700, file: 'rajdhani-latin-700-normal.woff2' },
  { family: 'JetBrains Mono', weight: 400, file: 'jetbrains-mono-latin-400-normal.woff2' },
  { family: 'JetBrains Mono', weight: 700, file: 'jetbrains-mono-latin-700-normal.woff2' },
];

const dir = join(import.meta.dirname, '../../fonts');

let css: string | undefined;

export const fontFaces = (): string =>
  (css ??= FACES.map(
    ({ family, weight, file }) =>
      // block: a brief blank beats a flash of Arial Narrow in the headings.
      `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;` +
      `src:url(data:font/woff2;base64,${readFileSync(join(dir, file)).toString('base64')}) format("woff2")}`,
  ).join('\n'));
