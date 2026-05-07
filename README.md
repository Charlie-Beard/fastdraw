# FastDraw

A fast, free online drawing app at [fastdraw.online](https://fastdraw.online). No signup, no install, no framework — just open and draw.

## Features

- **Pen** — freehand strokes with Chaikin curve smoothing
- **Shapes** — rectangles and ovals with live preview
- **Text** — click to place, type, Enter to commit
- **Eraser** — fixed-radius eraser
- **5 colours** — dark, red, blue, green, purple
- **Save PNG** — auto-crops to drawn content
- **Live sharing** — share a `?room=` link for real-time collaborative sessions via WebRTC (PeerJS)

## Architecture

Single-page app — no build step, no runtime dependencies on initial load.

| File | Purpose |
|------|---------|
| `index.html` | HTML skeleton, meta tags, CSP |
| `draw.css` | All styles |
| `draw.js` | All application logic (IIFE) |

PeerJS is lazy-loaded from CDN only when Share is clicked.

## Running locally

No build step required. Just serve the files:

```sh
npx serve .
# or
python3 -m http.server
```

Then open `http://localhost:3000` (or whichever port).

## Deployment

Pushes to `main` auto-deploy to [fastdraw.online](https://fastdraw.online) via GitHub Pages + Actions.

## Live sharing

The host clicks **Share**, gets a `?room={id}` URL, and shares it. Joiners open the URL and connect directly to the host over WebRTC. The host syncs the current canvas as a JPEG then broadcasts all subsequent drawing operations. Closing the host tab ends the session for all participants.

## Drawing operation schema

All drawing actions are represented as plain objects — used locally in `applyOp` and sent over WebRTC during live sessions.

| type | fields |
|------|--------|
| `pen` | `pts [{x,y}]`, `iters`, `color`, `lw` |
| `dot` | `x`, `y`, `color`, `lw` |
| `rect` | `x0`, `y0`, `x1`, `y1`, `color`, `lw` |
| `oval` | `x0`, `y0`, `x1`, `y1`, `color`, `lw` |
| `text` | `x`, `y`, `text`, `fs`, `color` |
| `eraser` | `pts [{x,y}]`, `r` |
| `reset` | _(no fields)_ |

## How to extend

**Add a colour** — add a `<button class="sw" data-c="#hex">` in `index.html`. The `wireGroup('.sw', ...)` handler in `draw.js` picks it up automatically.

**Add a tool** — add a `data-tool` button in `index.html`, handle the new tool in the `pointerdown`/`pointermove`/`endDraw` blocks in `draw.js`, and add a matching branch in `applyOp`/`shareOp`.

**Change constants** — `WORLD_W`/`WORLD_H`, `MAX_SCALE`, `ERASER_R`, and `FONT_STACK` are all defined at the top of the IIFE in `draw.js`.

**Add a CDN resource** — update the `Content-Security-Policy` meta tag in `index.html` to allow the new origin (see CLAUDE.md for details).
