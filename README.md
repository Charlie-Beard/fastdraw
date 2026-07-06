# FastDraw

A fast, free online drawing app at [fastdraw.online](https://fastdraw.online). No signup, no install, no framework — just open and draw.

## Features

- **Pen** — freehand strokes with Chaikin curve smoothing
- **Shapes** — rectangles and ovals with live preview
- **Text** — click to place, type, Enter to commit
- **Eraser** — fixed-radius eraser
- **Undo / redo** — full history, synced across live sessions
- **5 colours** — dark, red, blue, green, purple
- **Save PNG** — auto-crops to drawn content
- **Live sharing** — share a `?room=` link for real-time collaborative sessions via PartyKit (WebSockets)

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `P` / `R` / `O` / `T` / `E` | Pen / Rect / Oval / Text / Eraser |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` | Redo |
| `Ctrl/Cmd+S` | Save PNG |
| `Esc` | Close dialogs / cancel text |

## Architecture

Single-page app — no build step, no runtime dependencies on initial load.

| File | Purpose |
|------|---------|
| `index.html` | HTML skeleton, meta tags, CSP |
| `draw.css` | All styles |
| `draw.js` | All application logic (IIFE) |
| `server.ts` | PartyKit room server for live sharing |

The canvas is always reproducible as *baseline + op log*: every committed action (stroke, shape, text, eraser pass, reset) is a plain op object appended to `ops`, and undo/redo pop/push that log and replay it. The same op objects are broadcast over the wire during live sessions.

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

The host clicks **Share**, gets a `?room={id}` URL, and shares it. All participants connect to a PartyKit room (`server.ts`) over WebSockets. On session start the host uploads the canvas as a JPEG snapshot; the server hands that snapshot to each joiner and relays all subsequent drawing operations. The host also re-uploads the snapshot (debounced) after activity so late joiners see a current canvas. Undo/redo are broadcast as ops, so history stays consistent across participants.

## Drawing operation schema

All drawing actions are represented as plain objects — appended to the local history in `commitOp`/`renderOp` and sent over WebSockets during live sessions.

| type | fields |
|------|--------|
| `pen` | `pts [{x,y}]`, `iters`, `color`, `lw` |
| `dot` | `x`, `y`, `color`, `lw` |
| `rect` | `x0`, `y0`, `x1`, `y1`, `color`, `lw` |
| `oval` | `x0`, `y0`, `x1`, `y1`, `color`, `lw` |
| `text` | `x`, `y`, `text`, `fs`, `color` |
| `eraser` | `pts [{x,y}]`, `r` |
| `reset` | _(no fields)_ |
| `undo` / `redo` | _(no fields — pop/push the shared history)_ |

## How to extend

**Add a colour** — add a `<button class="sw" data-c="#hex">` in `index.html`. The `wireGroup('.sw', ...)` handler in `draw.js` picks it up automatically.

**Add a tool** — add a `data-tool` button in `index.html`, handle the new tool in the `pointerdown`/`pointermove`/`endDraw` blocks in `draw.js`, and add a matching branch in `applyOp`/`shareOp`.

**Change constants** — `WORLD_W`/`WORLD_H`, `MAX_SCALE`, `ERASER_R`, and `FONT_STACK` are all defined at the top of the IIFE in `draw.js`.

**Add a CDN resource** — update the `Content-Security-Policy` meta tag in `index.html` to allow the new origin (see CLAUDE.md for details).
