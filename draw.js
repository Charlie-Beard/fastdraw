  (function(){
    const $=id=>document.getElementById(id);
    const base = $('base');
    const prev = $('preview');
    const wrap = $('wrap');
    const ti   = $('ti');
    const bx   = base.getContext('2d', { alpha: false });
    const px   = prev.getContext('2d');
    let dpr = devicePixelRatio || 1;
    const WORLD_W = 3000, WORLD_H = 2000;
    const MAX_SCALE = 8;
    const cdpr = Math.min(dpr, 2); // cap at 2× — 3× displays would quadruple canvas memory for negligible visual gain
    let s = 1, ox = 0, oy = 0;
    let hdH = 44, tbH = 80;

    function minScale() {
      const w = window.innerWidth;
      const h = window.innerHeight - hdH - tbH;
      return Math.max(w / WORLD_W, h / WORLD_H);
    }

    function fitToContent(bounds) {
      if (!bounds) { fitToView(); return; }
      const pad = 60; // visual breathing room around drawn content
      const cw = bounds.x2 - bounds.x1 + 2 * pad;
      const ch = bounds.y2 - bounds.y1 + 2 * pad;
      const availW = window.innerWidth;
      const availH = window.innerHeight - hdH - tbH;
      s = Math.min(availW / cw, availH / ch, MAX_SCALE);
      s = Math.max(s, minScale());
      const cx = (bounds.x1 + bounds.x2) / 2;
      const cy = (bounds.y1 + bounds.y2) / 2;
      ox = availW / 2 - cx * s;
      oy = hdH + availH / 2 - cy * s;
      updateTransform();
    }

    function fitToView() {
      const INITIAL_ZOOM = 1.5;
      s = Math.max(minScale(), INITIAL_ZOOM);
      s = Math.min(s, MAX_SCALE);
      ox = (window.innerWidth - WORLD_W * s) / 2;
      oy = hdH + ((window.innerHeight - hdH - tbH) - WORLD_H * s) / 2;
      updateTransform();
    }

    function initCanvas(c, ctx) {
      c.width  = WORLD_W * cdpr;
      c.height = WORLD_H * cdpr;
      c.style.width  = WORLD_W + 'px';
      c.style.height = WORLD_H + 'px';
      ctx.scale(cdpr, cdpr);
    }

    function updateTransform() {
      // clamp so the canvas edge can never be scrolled past the viewport edge
      ox = Math.min(0, Math.max(window.innerWidth - WORLD_W * s, ox));
      oy = Math.min(hdH, Math.max((window.innerHeight - tbH) - WORLD_H * s, oy));
      $('stage').style.transform = `matrix(${s},0,0,${s},${ox},${oy})`;
    }

    function zoomAt(sx, sy, factor) {
      const ns = Math.max(minScale(), Math.min(MAX_SCALE, s * factor));
      // convert the screen pivot point to world coords at old scale, then recompute
      // offset so that same world point stays under the pointer at the new scale
      const wx = (sx - ox) / s;
      const wy = (sy - oy) / s;
      ox = sx - wx * ns;
      oy = sy - wy * ns;
      s  = ns;
      updateTransform();
    }

    function boot() {
      initCanvas(base, bx);
      bx.fillStyle = '#fff'; bx.fillRect(0, 0, WORLD_W, WORLD_H);
      initCanvas(prev, px);
      hdH = $('hd').offsetHeight;
      tbH = $('tb').offsetHeight;
      fitToView();
    }

    boot();

    window.addEventListener('resize', () => {
      hdH = $('hd').offsetHeight;
      tbH = $('tb').offsetHeight;
      const ms = minScale();
      if (s < ms) s = ms;
      updateTransform();
    });

    // Tool state
    const FONT_STACK = 'px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    const S = { tool: 'pen', color: '#1a1a1a', fs: 24, lw: 2.5 };
    const ERASER_R = 20;
    let active = false, pid = -1, x0 = 0, y0 = 0, pts = [], rafPending = false, rx = 0, ry = 0;
    const ptrs = new Map();
    let _prevPtrs = null; // snapshot of ptrs from previous frame — cloned so live mutations don't corrupt the delta calc
    let db = null;
    function expandBounds(x, y) {
      if (!db) db = {x1:x, y1:y, x2:x, y2:y};
      else { db.x1=Math.min(db.x1,x); db.y1=Math.min(db.y1,y); db.x2=Math.max(db.x2,x); db.y2=Math.max(db.y2,y); }
    }

    // ── History (undo/redo) ───────────────────────────────────────────────────
    // Every committed action is an op. The canvas is always reproducible as
    // baseline (white, or the snapshot a joiner received) + ops replayed in order.
    let ops = [], redoStack = [];
    let baseline = null, baseDb = null; // snapshot image + its bounds (joiners / share start)

    // Draw an op onto the base canvas and expand db to cover it.
    // Eraser subtracts content so it never expands bounds.
    function renderOp(op) {
      applyStyle(bx, op.color, op.lw);
      if (op.type === 'pen') { polyline(bx, chaikin(op.pts, op.iters)); op.pts.forEach(p => expandBounds(p.x, p.y)); }
      else if (op.type === 'dot') { bx.beginPath(); bx.arc(op.x, op.y, op.lw/2, 0, Math.PI*2); bx.fill(); expandBounds(op.x, op.y); }
      else if (op.type === 'rect') { drawRect(bx, op.x0, op.y0, op.x1, op.y1); expandBounds(op.x0, op.y0); expandBounds(op.x1, op.y1); }
      else if (op.type === 'oval') { drawOval(bx, op.x0, op.y0, op.x1, op.y1); expandBounds(op.x0, op.y0); expandBounds(op.x1, op.y1); }
      else if (op.type === 'text') {
        bx.font = op.fs + FONT_STACK;
        bx.fillText(op.text, op.x, op.y);
        const m = bx.measureText(op.text);
        expandBounds(op.x, op.y - (m.actualBoundingBoxAscent || op.fs * 0.8));
        expandBounds(op.x + m.width, op.y + (m.actualBoundingBoxDescent || op.fs * 0.25));
      }
      else if (op.type === 'eraser') op.pts.forEach(p => erase(p.x, p.y, op.r));
      else if (op.type === 'reset') { bx.fillStyle = '#fff'; bx.fillRect(0, 0, WORLD_W, WORLD_H); db = null; }
    }

    function repaint() {
      bx.fillStyle = '#fff'; bx.fillRect(0, 0, WORLD_W, WORLD_H);
      db = baseDb ? {...baseDb} : null;
      if (baseline) bx.drawImage(baseline, 0, 0, WORLD_W, WORLD_H);
      ops.forEach(renderOp);
    }

    function syncHistBtns() {
      $('undo').disabled = !ops.length;
      $('redo').disabled = !redoStack.length;
    }

    function commitOp(op) {
      ops.push(op);
      redoStack.length = 0;
      renderOp(op);
      if (shareActive) shareOp(op);
      scheduleSnapshot();
      syncHistBtns();
    }

    function doUndo(broadcast = true) {
      if (!ops.length) return;
      redoStack.push(ops.pop());
      repaint();
      if (broadcast && shareActive) shareOp({type:'undo'});
      scheduleSnapshot();
      syncHistBtns();
    }

    function doRedo(broadcast = true) {
      if (!redoStack.length) return;
      const op = redoStack.pop();
      ops.push(op);
      renderOp(op);
      if (broadcast && shareActive) shareOp({type:'redo'});
      scheduleSnapshot();
      syncHistBtns();
    }

    function pos(e) {
      return { x: (e.clientX - ox) / s, y: (e.clientY - oy) / s };
    }

    function applyStyle(ctx, color=S.color, lw=S.lw) {
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.lineWidth   = lw;
      ctx.lineCap = ctx.lineJoin = 'round';
    }

    function erase(x, y, r) { bx.fillStyle='#fff'; bx.beginPath(); bx.arc(x,y,r,0,Math.PI*2); bx.fill(); }

    // Chaikin's corner-cutting algorithm: each pass replaces every segment with two
    // points at the 1/4 and 3/4 positions, progressively smoothing the polyline.
    function chaikin(p, n) {
      if (p.length < 3) return p;
      let a = p;
      for (let i = 0; i < n; i++) {
        const b = [a[0]];
        for (let j = 0; j < a.length - 1; j++) {
          b.push({ x: .75*a[j].x + .25*a[j+1].x, y: .75*a[j].y + .25*a[j+1].y });
          b.push({ x: .25*a[j].x + .75*a[j+1].x, y: .25*a[j].y + .75*a[j+1].y });
        }
        b.push(a[a.length - 1]);
        a = b;
      }
      return a;
    }

    function polyline(ctx, p) {
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.stroke();
    }

    function drawRect(ctx, x1, y1, x2, y2) {
      ctx.beginPath();
      ctx.rect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
      ctx.stroke();
    }

    function drawOval(ctx, x1, y1, x2, y2) {
      const cx = (x1+x2)/2, cy = (y1+y2)/2;
      const rx = Math.abs(x2-x1)/2 || 0.5;
      const ry = Math.abs(y2-y1)/2 || 0.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
      ctx.stroke();
    }

    // Pointer handling
    wrap.addEventListener('pointerdown', e => {
      ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (e.button > 0) return;
      if (ptrs.size >= 2) {
        // second finger = pinch gesture; abandon the in-progress stroke
        if (active) {
          active = false;
          px.clearRect(0, 0, WORLD_W, WORLD_H);
          // eraser already changed the base canvas — record what happened so
          // history replay and live peers stay consistent
          if (S.tool === 'eraser' && pts.length) commitOp({type:'eraser', pts, r:ERASER_R});
        }
        return;
      }
      wrap.setPointerCapture(e.pointerId);
      pid = e.pointerId;
      const {x, y} = pos(e);

      if (S.tool === 'text') {
        e.preventDefault(); // stop the follow-up mousedown from stealing focus off #ti
        commitText();
        showText(x, y);
        return;
      }

      active = true;
      x0 = x; y0 = y;
      px.clearRect(0, 0, WORLD_W, WORLD_H);

      if (S.tool === 'pen') {
        pts = [{x, y}];
        applyStyle(px);
        px.beginPath();
        px.moveTo(x, y);
      } else if (S.tool === 'eraser') {
        pts = [{x, y}];
        erase(x, y, ERASER_R);
      }
    });

    wrap.addEventListener('pointermove', e => {
      ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (ptrs.size >= 2) {
        // Simultaneous pinch-zoom + pan: scale factor = distance ratio between frames,
        // translation = midpoint delta. Guard pd > 0 prevents divide-by-zero on first frame.
        const [a, b] = [...ptrs.values()];
        const dist = Math.hypot(b.x-a.x, b.y-a.y);
        const midX = (a.x+b.x)/2, midY = (a.y+b.y)/2;
        if (_prevPtrs) {
          const [pa, pb] = [..._prevPtrs.values()];
          const pd = Math.hypot(pb.x-pa.x, pb.y-pa.y);
          const pmx = (pa.x+pb.x)/2, pmy = (pa.y+pb.y)/2;
          if (pd > 0) {
            const ns = Math.max(minScale(), Math.min(MAX_SCALE, s * dist / pd));
            const wx = (pmx - ox) / s, wy = (pmy - oy) / s;
            ox = midX - wx * ns; oy = midY - wy * ns; s = ns;
          } else { ox += midX - pmx; oy += midY - pmy; }
          updateTransform();
        }
        _prevPtrs = new Map(ptrs);
        return;
      }
      _prevPtrs = null;
      if (!active || e.pointerId !== pid) return;
      const {x, y} = pos(e);

      if (S.tool === 'pen') {
        const l = pts[pts.length - 1];
        const dx = x - l.x, dy = y - l.y;
        if (dx*dx + dy*dy > 4) { // squared-distance threshold (2px) avoids sqrt per event and culls micro-jitter
          pts.push({x, y});
          applyStyle(px);
          px.lineTo(x, y);
          px.stroke();
          px.beginPath();
          px.moveTo(x, y);
        }
      } else if (S.tool === 'eraser') {
        const l = pts[pts.length - 1];
        const dx = x - l.x, dy = y - l.y;
        if (dx*dx + dy*dy > 4) { // same squared-distance threshold as pen
          pts.push({x, y});
          erase(x, y, ERASER_R);
        }
      } else {
        rx = x; ry = y;
        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(() => {
            rafPending = false;
            if (!active) return;
            px.clearRect(0, 0, WORLD_W, WORLD_H);
            applyStyle(px);
            S.tool === 'rect' ? drawRect(px, x0, y0, rx, ry) : drawOval(px, x0, y0, rx, ry);
          });
        }
      }
    });

    function endDraw(e) {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) _prevPtrs = null;
      if (!active || e.pointerId !== pid) return;
      active = false; pid = -1;
      const {x, y} = pos(e);
      px.clearRect(0, 0, WORLD_W, WORLD_H);

      let op = null;

      if (S.tool === 'eraser') {
        pts.push({x, y});
        op = {type:'eraser', pts, r:ERASER_R};
      } else if (S.tool === 'pen') {
        pts.push({x, y});
        if (pts.length === 1) {
          op = {type:'dot', x:pts[0].x, y:pts[0].y, color:S.color, lw:S.lw};
        } else {
          const iters = pts.length > 8 ? 3 : 1; // more points = more smoothing needed; capped at 3 to avoid exponential point explosion
          op = {type:'pen', pts, iters, color:S.color, lw:S.lw};
        }
      } else if (S.tool === 'rect') {
        op = {type:'rect', x0, y0, x1:x, y1:y, color:S.color, lw:S.lw};
      } else if (S.tool === 'oval') {
        op = {type:'oval', x0, y0, x1:x, y1:y, color:S.color, lw:S.lw};
      }

      if (op) commitOp(op);
    }

    wrap.addEventListener('pointerup',     endDraw);
    wrap.addEventListener('pointercancel', endDraw);
    wrap.addEventListener('contextmenu',   e => e.preventDefault());

    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.005));
      } else {
        ox -= e.deltaX; oy -= e.deltaY;
        updateTransform();
      }
    }, { passive: false });

    // Text tool
    let ttx = 0, tty = 0;

    function showText(x, y) {
      ttx = x; tty = y;
      ti.value = '';
      ti.style.display  = 'block';
      ti.style.left     = (x * s + ox) + 'px';
      ti.style.top      = ((y - S.fs) * s + oy) + 'px';
      ti.style.fontSize = (S.fs * s) + 'px';
      ti.style.color    = S.color;
      ti.style.width    = '4px';
      ti.focus();
    }

    function commitText() {
      if (ti.style.display === 'none') return;
      const t = ti.value.trim();
      if (t) commitOp({type:'text', x:ttx, y:tty, text:t, fs:S.fs, color:S.color});
      ti.style.display = 'none';
      ti.value = '';
    }

    ti.addEventListener('input', () => {
      ti.style.width = Math.max(4, ti.scrollWidth) + 'px';
    });

    ti.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); commitText(); }
      if (e.key === 'Escape') { ti.style.display = 'none'; ti.value = ''; }
    });

    ti.addEventListener('blur', () => {
      // 80ms delay lets a toolbar button click register before blur fires,
      // so switching tools doesn't spuriously commit with an empty string
      setTimeout(() => {
        if (ti.style.display !== 'none' && document.activeElement !== ti) commitText();
      }, 80);
    });

    function wireGroup(sel, onPick) {
      const bs = document.querySelectorAll(sel);
      bs.forEach(b => b.addEventListener('click', () => {
        bs.forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        onPick(b);
      }));
      return bs;
    }

    // Toolbar — tools
    wireGroup('[data-tool]', b => {
      S.tool = b.dataset.tool;
      $('fsz').classList.toggle('dim', S.tool !== 'text');
      wrap.classList.toggle('erasing', S.tool === 'eraser');
      wrap.classList.toggle('texting', S.tool === 'text');
      if (S.tool !== 'text') commitText();
    });

    // Toolbar — colours
    wireGroup('.sw', b => {
      S.color = b.dataset.c;
      if (ti.style.display !== 'none') ti.style.color = S.color;
    }).forEach(b => b.style.background = b.dataset.c);

    // Toolbar — font sizes
    wireGroup('[data-fs]', b => {
      S.fs = +b.dataset.fs;
      if (ti.style.display !== 'none') ti.style.fontSize = S.fs + 'px';
    });

    // Reset — recorded as an op so it can be undone
    $('rst').addEventListener('click', () => {
      if (shareActive) { $('rm').style.display = 'flex'; return; }
      commitText();
      if (db) commitOp({type:'reset'});
      fitToView();
    });

    // Undo / redo
    $('undo').addEventListener('click', () => { commitText(); doUndo(); });
    $('redo').addEventListener('click', () => { commitText(); doRedo(); });

    // Keyboard shortcuts
    const TOOL_KEYS = {p:'pen', r:'rect', o:'oval', t:'text', e:'eraser'};
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeModal();
        $('rm').style.display = 'none';
        $('ov-end').style.display = 'none';
        return;
      }
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
        else if (k === 'y') { e.preventDefault(); doRedo(); }
        else if (k === 's') { e.preventDefault(); savePng(); }
        return;
      }
      if (e.altKey) return;
      if (TOOL_KEYS[k]) document.querySelector(`[data-tool="${TOOL_KEYS[k]}"]`).click();
    });

    // Warn before discarding a non-empty drawing
    window.addEventListener('beforeunload', e => {
      if (db) { e.preventDefault(); e.returnValue = ''; }
    });

    // Performance metrics
    function measurePerf() {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        const sz = nav.encodedBodySize || nav.transferSize;
        if (sz > 256) $('s-size').textContent = (sz / 1024).toFixed(1);
        if (nav.duration > 0) $('s-load').textContent = Math.round(nav.duration) + ' ms';
      }
      if (window.PerformanceObserver) {
        const obs = new PerformanceObserver(list => {
          for (const e of list.getEntries()) {
            if (e.name === 'first-contentful-paint') {
              $('s-fcp').textContent = Math.round(e.startTime) + ' ms';
              obs.disconnect();
            }
          }
        });
        try { obs.observe({ type: 'paint', buffered: true }); } catch(_) {}
      }
    }
    if (document.readyState === 'complete') setTimeout(measurePerf, 0);
    else addEventListener('load', () => setTimeout(measurePerf, 0));

    // Download
    function savePng() {
      commitText();
      const a = document.createElement('a');
      const p2 = n => String(n).padStart(2,'0');
      const d = new Date();
      const ts = `${d.getFullYear()}${p2(d.getMonth()+1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      a.download = ts + '-fastdraw.png';
      if (db) {
        const pad = 20;
        const cx = Math.max(0, db.x1 - pad), cy = Math.max(0, db.y1 - pad);
        const cw = Math.min(WORLD_W, db.x2 + pad) - cx;
        const ch = Math.min(WORLD_H, db.y2 + pad) - cy;
        const tmp = document.createElement('canvas');
        tmp.width = cw * cdpr; tmp.height = ch * cdpr;
        tmp.getContext('2d').drawImage(base, cx * cdpr, cy * cdpr, cw * cdpr, ch * cdpr, 0, 0, cw * cdpr, ch * cdpr);
        a.href = tmp.toDataURL();
      } else {
        a.href = base.toDataURL();
      }
      a.click();
    }
    $('dl').addEventListener('click', savePng);

    // ── Live sharing ──────────────────────────────────────────────────────────

    let shareActive = false;
    let ws = null;
    let isHost = false;       // creator of the room — responsible for snapshot refreshes
    let snapTimer = 0;
    let initQueue = null;     // ops received while the init snapshot image is still decoding
    const PARTYKIT_HOST = location.hostname === 'localhost'
      ? 'localhost:1999'
      : 'fastdraw.charlie-beard.partykit.dev';

    // Apply a received draw operation, keeping local history in sync
    function handleRemoteOp(op) {
      if (initQueue) { initQueue.push(op); return; }
      if (op.type === 'undo') doUndo(false);
      else if (op.type === 'redo') doRedo(false);
      else {
        ops.push(op);
        redoStack.length = 0;
        renderOp(op);
        scheduleSnapshot();
        syncHistBtns();
      }
    }

    function shareOp(op) {
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'draw', op }));
    }

    // The server hands new joiners its stored snapshot, so the host refreshes it
    // (debounced) after activity — otherwise late joiners would see a stale canvas.
    function scheduleSnapshot() {
      if (!isHost || !shareActive) return;
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'snapshot', canvas: base.toDataURL('image/jpeg', 0.85), db }));
      }, 2500);
    }

    function setLiveBadge(n) {
      $('live-count').textContent = n - 1;
      $('live-badge').style.display = n > 1 ? 'flex' : 'none';
    }

    function endSession() {
      if (ws) {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'end' }));
        try { ws.close(); } catch(_) {}
        ws = null;
      }
      shareActive = false;
      isHost = false;
      clearTimeout(snapTimer);
      initQueue = null;
      history.replaceState(null, '', location.pathname);
      $('shr').textContent = 'Share';
      $('shr').classList.remove('live');
      setLiveBadge(0);
      commitText();
      db = null;
      ops = []; redoStack = []; baseline = null; baseDb = null;
      syncHistBtns();
      bx.fillStyle = '#fff'; bx.fillRect(0, 0, WORLD_W, WORLD_H);
      px.clearRect(0, 0, WORLD_W, WORLD_H);
    }

    function connectToRoom(roomId, isCreator) {
      const proto = location.hostname === 'localhost' ? 'ws' : 'wss';
      isHost = isCreator;
      ws = new WebSocket(`${proto}://${PARTYKIT_HOST}/party/${roomId}`);

      ws.onopen = () => {
        shareActive = true;
        history.replaceState(null, '', `?room=${roomId}`);
        $('sm-url').value = location.href;
        $('sm-conn').style.display    = 'none';
        $('sm-btns').style.display    = 'none';
        $('sm-url-row').style.display = 'flex';
        $('shr').classList.add('live');
        $('shr').textContent = 'Shared';
        $('ov-conn').style.display = 'none';
        if (isCreator) {
          const snap = base.toDataURL('image/jpeg', 0.85);
          ws.send(JSON.stringify({ type: 'snapshot', canvas: snap, db }));
          // Flatten local history into the snapshot so every participant's
          // (baseline, ops) history matches and undo stays consistent
          const img = new Image();
          img.onload = () => { baseline = img; baseDb = db ? {...db} : null; ops = []; redoStack = []; syncHistBtns(); };
          img.src = snap;
        }
      };

      ws.onmessage = e => {
        const data = JSON.parse(e.data);
        if (data.type === 'init') {
          initQueue = []; // hold ops until the snapshot image has decoded
          const img = new Image();
          img.onload = () => {
            baseline = img;
            baseDb = data.db ? {...data.db} : null;
            ops = []; redoStack = [];
            repaint();
            syncHistBtns();
            fitToContent(data.db);
            const q = initQueue; initQueue = null;
            q.forEach(handleRemoteOp);
          };
          img.src = data.canvas;
        } else if (data.type === 'draw') {
          handleRemoteOp(data.op);
        } else if (data.type === 'count') {
          setLiveBadge(data.n);
        } else if (data.type === 'end') {
          shareActive = false;
          ws = null;
          setLiveBadge(0);
          $('ov-end').style.display = 'flex';
        }
      };

      ws.onerror = () => {
        $('sm-conn').style.display = 'none';
        $('sm-err').style.display  = 'block';
        $('sm-go').disabled = false;
        $('ov-conn').style.display = 'none';
      };

      ws.onclose = () => {
        if (!shareActive) return;
        shareActive = false;
        ws = null;
        setLiveBadge(0);
        $('ov-end').style.display = 'flex';
      };
    }

    function startSession() {
      $('sm-go').disabled = true;
      $('sm-conn').style.display = 'block';
      $('sm-err').style.display  = 'none';
      const roomId = Math.random().toString(36).slice(2, 8);
      connectToRoom(roomId, true);
    }

    function joinSession(roomId) {
      $('ov-conn').style.display = 'flex';
      connectToRoom(roomId, false);
    }

    // Share button
    function openModal() {
      const s = shareActive;
      $('sm-conn').style.display    = 'none';
      $('sm-err').style.display     = 'none';
      $('sm-btns').style.display    = s ? 'none' : 'flex';
      $('sm-url-row').style.display = s ? 'flex' : 'none';
      if (!s) $('sm-go').disabled = false;
      $('sm').style.display = 'flex';
    }
    $('shr').addEventListener('click', openModal);

    function closeModal() { $('sm').style.display = 'none'; }
    $('sm-cancel').addEventListener('click', closeModal);
    $('sm-close').addEventListener('click', closeModal);
    $('rm-cancel').addEventListener('click', () => { $('rm').style.display = 'none'; });
    $('rm-go').addEventListener('click', () => { $('rm').style.display = 'none'; endSession(); });

    $('sm-go').addEventListener('click', startSession);

    $('sm-copy').addEventListener('click', () => {
      navigator.clipboard.writeText($('sm-url').value).then(() => {
        const btn = $('sm-copy');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 2000);
      });
    });

    // Session-ended overlay buttons
    $('ov-end-save').addEventListener('click', savePng);

    $('ov-end-cont').addEventListener('click', () => {
      $('ov-end').style.display = 'none';
    });

    // Detect join URL on page load
    const roomParam = new URLSearchParams(location.search).get('room');
    if (roomParam) joinSession(roomParam);

  })();
