# FastDraw

A fast, free online drawing app at [fastdraw.online](https://fastdraw.online). Single-page, no build step, no framework.

## Architecture

**Files:**
- `index.html` — HTML skeleton and meta
- `draw.css` — all styles
- `draw.js` — all application logic (IIFE)
- `server.ts` — PartyKit room server for live sharing

**Key state (in `draw.js`):**
- `S` — tool state: `{ tool, color, fs, lw }`. Current tool, colour, font size, line width.
- `bx` — base canvas context (committed drawing)
- `px` — preview canvas context (in-progress stroke, cleared on commit)
- `db` — bounding box of drawn content (`{x1, y1, x2, y2}`), used for auto-crop export. `null` when canvas is blank.
- `ptrs` — Map of active pointer IDs, used to detect two-finger gestures
- `ops` / `redoStack` — undo history. The canvas is always reproducible as `baseline` (white, or the snapshot a joiner received, with bounds `baseDb`) + `ops` replayed in order via `repaint()`. Commit every new action through `commitOp(op)` — it appends to history, renders, shares, and updates the undo/redo buttons.

**Canvas model:**
- World size: 3000×2000 px (constant `WORLD_W`, `WORLD_H`)
- Viewport: CSS transform matrix `matrix(s,0,0,s,ox,oy)` on `#stage`
- Zoom range: 0.2×–8× (`MIN_SCALE`, `MAX_SCALE`)
- DPR capped at 2 (`cdpr`) to avoid excessive memory on high-DPI screens

**Drawing tools:**
- `pen` — freehand strokes, smoothed with Chaikin subdivision (`chaikin()`, 1–3 iterations depending on point count)
- `rect` / `oval` — shape preview on `px`, committed to `bx` on pointer up
- `text` — positioned input field (`#ti`), committed on Enter/blur. The `pointerdown` that places it must `preventDefault()`, or the browser's default mousedown focus behaviour blurs the input immediately.
- `eraser` — `fillStyle='#fff'` circles on `bx`, radius `ERASER_R = 20`

**Keyboard shortcuts:** P/R/O/T/E switch tools, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo, Ctrl/Cmd+S save PNG, Esc closes dialogs.

**Live sharing (PartyKit):**
- All participants connect over WebSocket to a PartyKit room (`server.ts`; host `fastdraw.charlie-beard.partykit.dev`, or `localhost:1999` in dev via `npx partykit dev`)
- Host creates a random room ID, shares `?room={id}` URL, and uploads the canvas as a JPEG snapshot; the server stores it and hands it to each joiner as `init`
- `shareOp(op)` — sends a `draw` message; the server relays it to every other connection. Undo/redo travel the same way as `{type:'undo'|'redo'}` ops
- `scheduleSnapshot()` — the host re-uploads the snapshot (debounced 2.5 s) after activity so late joiners don't get a stale canvas
- On share start the host flattens its local history into the snapshot baseline, so all participants share the same (baseline, ops) history
- `endSession()` — sends `end`, tears down the connection, resets canvas and URL

## CSP

The `Content-Security-Policy` meta tag in `index.html` is strict. Any new external resource (CDN, font, image domain) requires an explicit addition there. Changes to script-src or style-src need care — the inline `style=""` attributes in the HTML require `'unsafe-inline'` in `style-src`.

## Performance discipline

Bundle size is a recurring priority. Keep JS and CSS minimal. No runtime dependencies — live sharing uses the browser's native WebSocket. Avoid adding new CDN scripts to the initial page load. The performance metrics in the header (size, FCP, load time) are a useful self-check.

## Deployment

GitHub Pages via Actions (`.github/workflows/deploy.yml`). Push to `main` → auto-deploys to `fastdraw.online`.

**Custom domain DNS (at your DNS provider):**
- A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` → `fastdraw.online`
- CNAME: `www.fastdraw.online` → `charlie-beard.github.io`
- Enable HTTPS in GitHub repo Settings → Pages after DNS propagates
