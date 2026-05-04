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
