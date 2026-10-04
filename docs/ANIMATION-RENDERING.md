# Rendering the product film

## Requirements

- Node.js 24 and this project's dev dependencies (`npm ci`), which include Playwright.
- Chromium for Playwright: `npx playwright install chromium`.
- ffmpeg 6 or newer on `PATH` (rendered here with ffmpeg 8.0.1).

Nothing here is used by the application, its Docker image or CI.

## Files

| File                                                            | Role                                      |
| --------------------------------------------------------------- | ----------------------------------------- |
| [animation/index.html](../animation/index.html)                 | Stage, font faces, preview player         |
| [animation/scene.js](../animation/scene.js)                     | The film: drawings and timeline           |
| [animation/motion.js](../animation/motion.js)                   | Easing, tweening and `seek(t)`            |
| [animation/render.mjs](../animation/render.mjs)                 | Frame capture and encoding                |
| [animation/render.config.json](../animation/render.config.json) | Output name, poster time, preview segment |

The scene loads `docs/screenshots/admin-monitors.png` and `docs/screenshots/mobile.png`; regenerate them
with `npm run screenshots` and re-render when the pages change.

## Commands

Run from the repository root:

```powershell
node animation/render.mjs --serve     # live preview with a scrubber at http://127.0.0.1:4321/animation/
node animation/render.mjs --preview   # quick check: 960x540, 15 fps, animation/out/signalpost-film-preview-check.mp4
node animation/render.mjs             # final: 1920x1080, 30 fps
```

The final render writes to `animation/out/` (git-ignored):

| Output                        | Description                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `signalpost-film.mp4`         | H.264 High, yuv420p, BT.709, `+faststart`, CRF 18, 645 frames, about 2.4 MB |
| `poster.jpg`                  | Frame at 10.6 s, 1280 px wide                                               |
| `preview.webp`                | 4 s looping preview from 12.6 s, 640 px, 12 fps                             |
| `signalpost-film-contact.jpg` | One frame per second for review                                             |
| `render-report.json`          | Frame count, duration, size, time                                           |

Frames are written to a temporary folder and deleted after encoding. A full render takes about 30 s of capture on the development laptop.

## Publishing

The MP4 is not committed. It is attached to the GitHub release of the matching tag:

```powershell
gh release upload v0.1.0 animation/out/signalpost-film.mp4 --clobber
Copy-Item animation/out/poster.jpg, animation/out/preview.webp docs/media/
```

`docs/media/poster.jpg` and `docs/media/preview.webp` are small and committed for the README.
