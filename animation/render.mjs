/* global window, document */ // used inside page.evaluate callbacks, which run in the browser
// render.mjs: renders an animation/index.html scene to MP4, poster, looping preview and a review contact sheet.
//
//   node animation/render.mjs                 full render, 1920x1080 at 30 fps
//   node animation/render.mjs --preview       quick check, 960x540 at 15 fps
//   node animation/render.mjs --serve         live preview in a browser (http://127.0.0.1:4321/animation/)
//
// Needs Playwright (Chromium) from the project's dev dependencies and ffmpeg on PATH. Nothing here is part of
// the application or its container image.
import { spawnSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(here, 'render.config.json'), 'utf8'));
const root = path.resolve(here, config.root ?? '..');
const args = process.argv.slice(2);
const preview = args.includes('--preview');
const serveOnly = args.includes('--serve');
const outDir = path.join(here, 'out');
const framesDir = path.join(outDir, preview ? 'frames-preview' : 'frames');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};

/** Static server rooted at the project so the scene can load fonts and screenshots by relative path. */
function serve(port) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(root, url);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function ffmpeg(list) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...list], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${list.join(' ')}`);
}

const scenePath = '/' + path.relative(root, here).split(path.sep).join('/') + '/index.html';

if (serveOnly) {
  await serve(4321);
  console.log(`Preview: http://127.0.0.1:4321${scenePath}  (Ctrl+C to stop)`);
} else {
  // Playwright is resolved from the package that has it as a dev dependency (config.requireFrom, default root).
  const require = createRequire(path.join(root, config.requireFrom ?? '.', 'package.json'));
  const { chromium } = require('@playwright/test');
  const server = await serve(0);
  const port = server.address().port;
  const fps = preview ? 15 : 30;
  const scale = preview ? 0.5 : 1;
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  await page.goto(`http://127.0.0.1:${port}${scenePath}?render=1`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => typeof window.seek === 'function');
  const duration = await page.evaluate(() => window.__duration);
  const count = Math.round(duration * fps);
  const started = Date.now();
  for (let i = 0; i < count; i++) {
    await page.evaluate((t) => window.seek(t), i / fps);
    await page.screenshot({
      path: path.join(framesDir, `${String(i).padStart(5, '0')}.jpg`),
      type: 'jpeg',
      quality: 94,
    });
    if (i % 60 === 0) process.stdout.write(`\rframe ${i}/${count}`);
  }
  // Poster at the configured moment, full resolution PNG then compressed JPEG for the README.
  await page.evaluate((t) => window.seek(t), config.posterAt);
  const posterPng = path.join(outDir, 'poster.png');
  await page.screenshot({ path: posterPng, type: 'png' });
  await browser.close();
  server.close();
  console.log(`\rcaptured ${count} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);

  const name = preview ? `${config.name}-preview-check.mp4` : `${config.name}.mp4`;
  const video = path.join(outDir, name);
  ffmpeg([
    '-framerate',
    String(fps),
    '-i',
    path.join(framesDir, '%05d.jpg'),
    '-c:v',
    'libx264',
    '-preset',
    preview ? 'veryfast' : 'slow',
    '-crf',
    preview ? '28' : '18',
    // JPEG frames are full range; convert to standard limited-range BT.709 so every player shows the same colours.
    '-vf',
    'scale=out_range=tv:out_color_matrix=bt709,format=yuv420p',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-color_range',
    'tv',
    '-tune',
    'animation',
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-movflags',
    '+faststart',
    video,
  ]);
  // Contact sheet: one frame per second for reviewing the whole video at a glance.
  ffmpeg([
    '-i',
    video,
    '-vf',
    'fps=1,scale=480:-1,tile=5x5',
    '-frames:v',
    '1',
    path.join(outDir, `${config.name}-contact.jpg`),
  ]);
  if (!preview) {
    ffmpeg(['-i', posterPng, '-vf', 'scale=1280:-1', '-q:v', '3', path.join(outDir, 'poster.jpg')]);
    // Short looping preview for the README: a segment chosen in render.config.json.
    ffmpeg([
      '-ss',
      String(config.previewFrom),
      '-t',
      String(config.previewSeconds),
      '-i',
      video,
      '-vf',
      'fps=12,scale=640:-1:flags=lanczos',
      '-loop',
      '0',
      '-c:v',
      'libwebp',
      '-quality',
      '62',
      '-compression_level',
      '6',
      path.join(outDir, 'preview.webp'),
    ]);
  }
  rmSync(framesDir, { recursive: true, force: true });
  const size = (statSync(video).size / 1024 / 1024).toFixed(2);
  writeFileSync(
    path.join(outDir, 'render-report.json'),
    JSON.stringify(
      {
        video: name,
        frames: count,
        fps,
        duration,
        sizeMB: Number(size),
        renderedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${video} (${size} MB)`);
}
