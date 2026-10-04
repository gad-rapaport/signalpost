// Build step after tsc: SQL migrations next to the compiled code, and the self-hosted font files into
// public/fonts (served from /assets/fonts; nothing is loaded from a third-party origin).
import { cpSync, mkdirSync } from 'node:fs';

cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });

const fonts = [
  ['barlow', 'barlow-latin-400-normal.woff2'],
  ['barlow', 'barlow-latin-500-normal.woff2'],
  ['barlow', 'barlow-latin-600-normal.woff2'],
  ['barlow-semi-condensed', 'barlow-semi-condensed-latin-600-normal.woff2'],
  ['red-hat-mono', 'red-hat-mono-latin-400-normal.woff2'],
];
mkdirSync('public/fonts', { recursive: true });
for (const [pkg, file] of fonts)
  cpSync(`node_modules/@fontsource/${pkg}/files/${file}`, `public/fonts/${file}`);
console.log(`copied migrations and ${fonts.length} font files`);
