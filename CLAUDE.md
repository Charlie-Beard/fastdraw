# FastDraw

A fast, free online drawing app at [fastdraw.online](https://fastdraw.online). Single-page, no build step, no framework.

## Architecture

**Files:**
- `index.html` — HTML skeleton and meta
- `draw.css` — all styles
- `draw.js` — all application logic (IIFE)

**Key state (in `draw.js`):**
- `S` — tool state: `{ tool, color, fs, lw }`. Current tool, colour, font size, line width.
- `bx` — base canvas context (committed drawing)
- `px` — preview canvas context (in-progress stroke, cleared on commit)
- `db` — bounding box of drawn content (`{x1, y1, x2, y2}`), used for auto-crop export. `null` when canvas is blank.
- `ptrs` — Map of active pointer IDs, used to detect two-finger gestures

**Canvas model:**
- World size: 3000×2000 px (constant `WORLD_W`, `WORLD_H`)
- Viewport: CSS transform matrix `matrix(s,0,0,s,ox,oy)` on `#stage`
- Zoom range: 0.2×–8× (`MIN_SCALE`, `MAX_SCALE`)
- DPR capped at 2 (`cdpr`) to avoid excessive memory on high-DPI screens

**Drawing tools:**
- `pen` — freehand strokes, smoothed with Chaikin subdivision (`chaikin()`, 1–3 iterations depending on point count)
- `rect` / `oval` — shape preview on `px`, committed to `bx` on pointer up
- `text` — positioned input field (`#ti`), committed on Enter/blur
- `eraser` — `fillStyle='#fff'` circles on `bx`, radius `ERASER_R = 20`

**Live sharing (PeerJS):**
- PeerJS loaded lazily from CDN (`https://unpkg.com/peerjs@1/dist/peerjs.min.js`) only when Share is clicked — never on initial page load
- Host creates a Peer, gets an ID, shares `?room={id}` URL
- Joiners connect to the host peer; host syncs canvas as JPEG then broadcasts operations
- `shareOp(op)` — host broadcasts to all peers; joiner sends to host who rebroadcasts
- `endSession()` — tears down all connections, resets canvas and URL

## CSP

The `Content-Security-Policy` meta tag in `index.html` is strict. Any new external resource (CDN, font, image domain) requires an explicit addition there. Changes to script-src or style-src need care — the inline `style=""` attributes in the HTML require `'unsafe-inline'` in `style-src`.

## Performance discipline

Bundle size is a recurring priority. Keep JS and CSS minimal. No runtime dependencies except PeerJS (lazy-loaded). Avoid adding new CDN scripts to the initial page load. The performance metrics in the header (size, FCP, load time) are a useful self-check.

## Deployment

GitHub Pages via Actions (`.github/workflows/deploy.yml`). Push to `main` → auto-deploys to `fastdraw.online`.

**Custom domain DNS (at your DNS provider):**
- A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` → `fastdraw.online`
- CNAME: `www.fastdraw.online` → `charlie-beard.github.io`
- Enable HTTPS in GitHub repo Settings → Pages after DNS propagates
