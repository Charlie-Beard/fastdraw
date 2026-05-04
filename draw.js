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
    const cdpr = Math.min(dpr, 2);
    let s = 1, ox = 0, oy = 0;
    let hdH = 44, tbH = 80;

    function minScale() {
      const w = window.innerWidth;
      const h = window.innerHeight - hdH - tbH;
      return Math.max(w / WORLD_W, h / WORLD_H);
    }

    function fitToContent(bounds) {
      if (!bounds) { fitToView(); return; }
      const pad = 60;
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
      ox = Math.min(0, Math.max(window.innerWidth - WORLD_W * s, ox));
      oy = Math.min(hdH, Math.max((window.innerHeight - tbH) - WORLD_H * s, oy));
      $('stage').style.transform = `matrix(${s},0,0,${s},${ox},${oy})`;
    }

    function zoomAt(sx, sy, factor) {
      const ns = Math.max(minScale(), Math.min(MAX_SCALE, s * factor));
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
    let _prevPtrs = null;
    let db = null;
    function expandBounds(x, y) {
      if (!db) db = {x1:x, y1:y, x2:x, y2:y};
      else { db.x1=Math.min(db.x1,x); db.y1=Math.min(db.y1,y); db.x2=Math.max(db.x2,x); db.y2=Math.max(db.y2,y); }
    }
    function expandOpBounds(op) {
      if (op.type==='dot') expandBounds(op.x, op.y);
      else if (op.type==='pen') op.pts.forEach(p => expandBounds(p.x, p.y));
      else if (op.type==='rect'||op.type==='oval') { expandBounds(op.x0,op.y0); expandBounds(op.x1,op.y1); }
      else if (op.type==='text') expandBounds(op.x, op.y);
      else if (op.type==='eraser') op.pts.forEach(p => { expandBounds(p.x-op.r,p.y-op.r); expandBounds(p.x+op.r,p.y+op.r); });
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
      if (ptrs.size >= 2) { active = false; return; }
      wrap.setPointerCapture(e.pointerId);
      pid = e.pointerId;
      const {x, y} = pos(e);

      if (S.tool === 'text') { commitText(); showText(x, y); return; }

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
        if (dx*dx + dy*dy > 4) {
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
        if (dx*dx + dy*dy > 4) {
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

      if (S.tool === 'eraser') {
        pts.push({x, y});
        erase(x, y, ERASER_R);
        if (shareActive) shareOp({type:'eraser', pts, r:ERASER_R});
        return;
      }

      applyStyle(bx);
      let op = null;

      if (S.tool === 'pen') {
        pts.push({x, y});
        if (pts.length === 1) {
          bx.beginPath();
          bx.arc(pts[0].x, pts[0].y, S.lw / 2, 0, Math.PI*2);
          bx.fill();
          op = {type:'dot', x:pts[0].x, y:pts[0].y, color:S.color, lw:S.lw};
        } else {
          const iters = pts.length > 8 ? 3 : 1;
          polyline(bx, chaikin(pts, iters));
          op = {type:'pen', pts, iters, color:S.color, lw:S.lw};
        }
      } else if (S.tool === 'rect') {
        drawRect(bx, x0, y0, x, y);
        op = {type:'rect', x0, y0, x1:x, y1:y, color:S.color, lw:S.lw};
      } else if (S.tool === 'oval') {
        drawOval(bx, x0, y0, x, y);
        op = {type:'oval', x0, y0, x1:x, y1:y, color:S.color, lw:S.lw};
      }

      if (op) expandOpBounds(op);
      if (op && shareActive) shareOp(op);
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
      if (t) {
        applyStyle(bx);
        bx.font = S.fs + FONT_STACK;
        bx.fillText(t, ttx, tty);
        expandBounds(ttx, tty); expandBounds(ttx + t.length * S.fs * 0.6, tty);
        if (shareActive) shareOp({type:'text', x:ttx, y:tty, text:t, fs:S.fs, color:S.color});
      }
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

    // Reset
    $('rst').addEventListener('click', () => {
      if (shareActive) { $('rm').style.display = 'flex'; return; }
      window.location.reload();
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

    let isHost = false, shareActive = false;
    let myPeer = null, peerConns = [], hostConn = null;

    // Lazy-load PeerJS from CDN only when sharing is initiated
    function loadPeerJS(cb) {
      if (window.Peer) { cb(); return; }
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/peerjs@1/dist/peerjs.min.js';
      s.onload = cb;
      s.onerror = () => {
        $('sm-conn').style.display = 'none';
        $('sm-err').textContent = 'Could not load sharing library. Check your connection.';
        $('sm-err').style.display = 'block';
        $('sm-go').disabled = false;
        $('ov-conn').style.display = 'none';
      };
      document.head.appendChild(s);
    }

    // Apply a received draw operation to the base canvas
    function applyOp(op) {
      if (op.type !== 'reset' && op.type !== 'eraser') expandOpBounds(op);
      applyStyle(bx, op.color, op.lw);
      if      (op.type === 'pen')   polyline(bx, chaikin(op.pts, op.iters));
      else if (op.type === 'dot')   { bx.beginPath(); bx.arc(op.x, op.y, op.lw/2, 0, Math.PI*2); bx.fill(); }
      else if (op.type === 'rect')  drawRect(bx, op.x0, op.y0, op.x1, op.y1);
      else if (op.type === 'oval')  drawOval(bx, op.x0, op.y0, op.x1, op.y1);
      else if (op.type === 'text')  { bx.font = op.fs + FONT_STACK; bx.fillText(op.text, op.x, op.y); }
      else if (op.type === 'reset')  { bx.fillStyle = '#fff'; bx.fillRect(0, 0, WORLD_W, WORLD_H); db = null; }
      else if (op.type === 'eraser') { op.pts.forEach(p => erase(p.x, p.y, op.r)); }
    }

    // Send op from this user — host broadcasts, joiner sends to host
    function shareOp(op) {
      if (isHost) peerConns.forEach(c => { if (c.open) c.send({type:'draw', op}); });
      else if (hostConn && hostConn.open) hostConn.send({type:'draw', op});
    }

    // Update the live badge and tell all peers the new count
    function setLiveBadge(n) {
      $('live-count').textContent = n - 1;
      $('live-badge').style.display = n > 1 ? 'flex' : 'none';
    }

    function updateCount() {
      const n = peerConns.filter(c => c.open).length + 1; // +1 for host
      setLiveBadge(n);
      peerConns.forEach(c => { if (c.open) c.send({type:'count', n}); });
    }

    // Tear down the session — disconnect peers, reset state and UI
    function endSession() {
      peerConns.forEach(c => { try { c.close(); } catch(_){} });
      peerConns = [];
      if (hostConn) { try { hostConn.close(); } catch(_){} hostConn = null; }
      if (myPeer)   { try { myPeer.destroy(); } catch(_){} myPeer = null; }
      isHost = false; shareActive = false;
      history.replaceState(null, '', location.pathname);
      $('shr').textContent = 'Share';
      $('shr').classList.remove('live');
      setLiveBadge(0);
      commitText();
      db = null;
      bx.fillStyle = '#fff'; bx.fillRect(0, 0, WORLD_W, WORLD_H);
      px.clearRect(0, 0, WORLD_W, WORLD_H);
    }

    // Host: wire up a new incoming connection
    function setupConn(conn) {
      peerConns.push(conn);
      conn.on('open', () => {
        // Sync the current canvas state to the new joiner
        conn.send({type:'init', canvas: base.toDataURL('image/jpeg', 0.85), db});
        updateCount();
      });
      conn.on('data', data => {
        if (data.type === 'draw') {
          applyOp(data.op);
          // Rebroadcast to all other peers
          peerConns.forEach(c => { if (c !== conn && c.open) c.send(data); });
        }
      });
      conn.on('close', () => {
        peerConns = peerConns.filter(c => c !== conn);
        updateCount();
      });
    }

    // Host: create a new session
    function startSession() {
      const smGo   = $('sm-go');
      const smConn = $('sm-conn');
      const smErr  = $('sm-err');
      smGo.disabled = true;
      smConn.style.display = 'block';
      smErr.style.display  = 'none';

      loadPeerJS(() => {
        myPeer = new Peer();
        myPeer.on('open', id => {
          isHost      = true;
          shareActive = true;
          history.replaceState(null, '', `?room=${id}`);
          $('sm-url').value = location.href;
          smConn.style.display = 'none';
          $('sm-btns').style.display = 'none';
          $('sm-url-row').style.display = 'flex';
          $('shr').classList.add('live');
          $('shr').textContent = 'Shared';
          setLiveBadge(1);
        });
        myPeer.on('connection', conn => setupConn(conn));
        myPeer.on('error', () => {
          smConn.style.display = 'none';
          smErr.style.display  = 'block';
          smGo.disabled = false;
        });
      });
    }

    // Joiner: connect to an existing session via room ID in URL
    function joinSession(roomId) {
      $('ov-conn').style.display = 'flex';
      loadPeerJS(() => {
        myPeer = new Peer();
        myPeer.on('open', () => {
          hostConn = myPeer.connect(roomId, { reliable: true });
          hostConn.on('open', () => {
            shareActive = true;
            $('ov-conn').style.display = 'none';
          });
          hostConn.on('data', data => {
            if (data.type === 'init') {
              const img = new Image();
              img.onload = () => {
                bx.drawImage(img, 0, 0, WORLD_W, WORLD_H);
                if (data.db) db = data.db;
                fitToContent(data.db);
              };
              img.src = data.canvas;
            } else if (data.type === 'draw') {
              applyOp(data.op);
            } else if (data.type === 'count') {
              setLiveBadge(data.n);
            }
          });
          hostConn.on('close', () => {
            shareActive = false;
            setLiveBadge(0);
            $('ov-end').style.display = 'flex';
          });
        });
        myPeer.on('error', () => {
          // Connection failed — just proceed in solo mode
          $('ov-conn').style.display = 'none';
        });
      });
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

    function closeModal() {
      $('sm').style.display = 'none';
      if (!shareActive && myPeer) { myPeer.destroy(); myPeer = null; }
    }
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

    // Detect join URL on page load and lazy-load PeerJS only if needed
    const roomParam = new URLSearchParams(location.search).get('room');
    if (roomParam) joinSession(roomParam);

  })();
