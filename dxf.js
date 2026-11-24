/*
 * DXF-Flächenberechnung
 * Liest ASCII-DXF, wertet nur Geometrie auf dem gewählten Layer (Standard "0") aus,
 * bildet geschlossene Konturen und berechnet die Netto-Fläche
 * (Außenkontur minus Innenkonturen/Bohrungen) in mm².
 */
(function (global) {
  'use strict';

  const CHORD_TOL = 0.001; // max. Sehnenabweichung in mm bei Bogen-Approximation
  const JOIN_TOL = 0.05;   // Toleranz zum Verbinden offener Konturenden in mm

  const UNIT_TO_MM = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100 };

  // ---------- Tokenizer ----------
  function tokenize(text) {
    const lines = text.split(/\r\n|\r|\n/);
    const pairs = [];
    let i = 0;
    while (i + 1 < lines.length) {
      const code = parseInt(lines[i].trim(), 10);
      if (isNaN(code)) { i++; continue; }
      pairs.push([code, lines[i + 1].trim()]);
      i += 2;
    }
    return pairs;
  }

  // Liest Entities ab Index i bis zu einem Stop-Typ (code 0), gibt {list, i} zurück
  function readRawEntities(pairs, i, stopTypes) {
    const list = [];
    while (i < pairs.length) {
      const [c, v] = pairs[i];
      if (c !== 0) { i++; continue; }
      if (stopTypes.includes(v)) break;
      const ent = { type: v, p: [] };
      i++;
      while (i < pairs.length && pairs[i][0] !== 0) { ent.p.push(pairs[i]); i++; }
      list.push(ent);
    }
    return { list, i };
  }

  function getNum(ent, code, def) {
    for (const [c, v] of ent.p) if (c === code) { const n = parseFloat(v); return isNaN(n) ? def : n; }
    return def;
  }
  function getStr(ent, code, def) {
    for (const [c, v] of ent.p) if (c === code) return v;
    return def;
  }

  // POLYLINE + VERTEX + SEQEND zusammenfassen
  function groupEntities(raw) {
    const out = [];
    for (let k = 0; k < raw.length; k++) {
      const e = raw[k];
      if (e.type === 'POLYLINE') {
        e.vertices = [];
        k++;
        while (k < raw.length && raw[k].type === 'VERTEX') { e.vertices.push(raw[k]); k++; }
        if (k < raw.length && raw[k].type !== 'SEQEND') k--;
        out.push(e);
      } else if (e.type === 'VERTEX' || e.type === 'SEQEND') {
        // verwaist, ignorieren
      } else out.push(e);
    }
    return out;
  }

  function parseDxf(text) {
    if (text.startsWith('AutoCAD Binary DXF')) throw new Error('Binäre DXF-Dateien werden nicht unterstützt (bitte als ASCII-DXF speichern).');
    const pairs = tokenize(text);
    let insunits = 0;
    const blocks = {};
    let entities = [];
    let i = 0;
    while (i < pairs.length) {
      const [c, v] = pairs[i];
      if (c === 0 && v === 'SECTION' && pairs[i + 1] && pairs[i + 1][0] === 2) {
        const name = pairs[i + 1][1];
        i += 2;
        if (name === 'HEADER') {
          while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
            if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS' && pairs[i + 1]) insunits = parseInt(pairs[i + 1][1], 10) || 0;
            i++;
          }
        } else if (name === 'BLOCKS') {
          while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
            if (pairs[i][0] === 0 && pairs[i][1] === 'BLOCK') {
              const bEnt = { type: 'BLOCK', p: [] };
              i++;
              while (i < pairs.length && pairs[i][0] !== 0) { bEnt.p.push(pairs[i]); i++; }
              const r = readRawEntities(pairs, i, ['ENDBLK', 'ENDSEC']);
              i = r.i;
              const bname = getStr(bEnt, 2, '');
              blocks[bname] = { base: [getNum(bEnt, 10, 0), getNum(bEnt, 20, 0)], ents: groupEntities(r.list) };
            } else i++;
          }
        } else if (name === 'ENTITIES') {
          const r = readRawEntities(pairs, i, ['ENDSEC']);
          i = r.i;
          entities = groupEntities(r.list);
        } else {
          while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) i++;
        }
      }
      i++;
    }
    return { insunits, blocks, entities };
  }

  // ---------- Geometrie ----------
  // Affine Matrix [a,b,c,d,e,f]: x' = a*x + c*y + e ; y' = b*x + d*y + f
  const IDENT = [1, 0, 0, 1, 0, 0];
  function mul(m, n) { // m ∘ n
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }
  function ap(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

  function arcSegments(r, sweep) {
    if (r <= CHORD_TOL) return 4;
    const step = 2 * Math.acos(Math.max(-1, 1 - CHORD_TOL / r));
    return Math.min(3600, Math.max(8, Math.ceil(Math.abs(sweep) / step)));
  }

  function arcPoints(cx, cy, r, a0, sweep, includeStart) {
    const n = arcSegments(r, sweep);
    const pts = [];
    for (let k = includeStart ? 0 : 1; k <= n; k++) {
      const a = a0 + sweep * k / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  // Polylinie mit Bulges -> Punktliste
  function bulgePolyline(verts, closed) {
    const pts = [];
    const n = verts.length;
    if (!n) return pts;
    pts.push([verts[0].x, verts[0].y]);
    const segs = closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const p1 = verts[k], p2 = verts[(k + 1) % n];
      const b = p1.b || 0;
      if (Math.abs(b) < 1e-12) { pts.push([p2.x, p2.y]); continue; }
      const dx = p2.x - p1.x, dy = p2.y - p1.y, c = Math.hypot(dx, dy);
      if (c < 1e-12) continue;
      const theta = 4 * Math.atan(b);
      const d = (c / 2) / Math.tan(theta / 2);
      const cx = (p1.x + p2.x) / 2 - d * dy / c;
      const cy = (p1.y + p2.y) / 2 + d * dx / c;
      const r = Math.hypot(p1.x - cx, p1.y - cy);
      const a0 = Math.atan2(p1.y - cy, p1.x - cx);
      const arc = arcPoints(cx, cy, r, a0, theta, false);
      arc[arc.length - 1] = [p2.x, p2.y];
      for (const p of arc) pts.push(p);
    }
    return pts;
  }

  function evalSpline(deg, knots, ctrl, weights) {
    const n = ctrl.length;
    if (n < 2 || knots.length !== n + deg + 1) return null;
    const P = ctrl.map((p, k) => { const w = weights[k] || 1; return [p[0] * w, p[1] * w, w]; });
    const t0 = knots[deg], t1 = knots[n];
    if (!(t1 > t0)) return null;
    const samples = Math.min(5000, Math.max(64, n * 24));
    const pts = [];
    for (let s = 0; s <= samples; s++) {
      const t = t0 + (t1 - t0) * s / samples;
      let k = deg;
      while (k < n - 1 && t >= knots[k + 1]) k++;
      const d = [];
      for (let j = 0; j <= deg; j++) d.push(P[j + k - deg].slice());
      for (let r = 1; r <= deg; r++) {
        for (let j = deg; j >= r; j--) {
          const den = knots[j + 1 + k - r] - knots[j + k - deg];
          const al = den === 0 ? 0 : (t - knots[j + k - deg]) / den;
          for (let q = 0; q < 3; q++) d[j][q] = (1 - al) * d[j - 1][q] + al * d[j][q];
        }
      }
      const h = d[deg];
      pts.push([h[0] / h[2], h[1] / h[2]]);
    }
    return pts;
  }

  // Kubischer Interpolationsspline (Sehnenlängen-Parametrisierung) durch Fitpunkte
  function interpFit(fit, closed) {
    let P = fit.slice();
    if (closed) {
      const a = P[0], b = P[P.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) P.push(a);
    }
    const n = P.length;
    if (n < 3) return P;
    const t = [0];
    for (let k = 1; k < n; k++) t.push(t[k - 1] + Math.max(1e-12, Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1])));
    function second(vals) { // natürlicher Spline: 2. Ableitungen (Thomas-Algorithmus)
      const M = new Array(n).fill(0), c = new Array(n).fill(0), d = new Array(n).fill(0);
      for (let i = 1; i < n - 1; i++) {
        const h0 = t[i] - t[i - 1], h1 = t[i + 1] - t[i];
        const a = h0, b = 2 * (h0 + h1), cc = h1;
        const r = 6 * ((vals[i + 1] - vals[i]) / h1 - (vals[i] - vals[i - 1]) / h0);
        const den = b - a * c[i - 1];
        c[i] = cc / den;
        d[i] = (r - a * d[i - 1]) / den;
      }
      for (let i = n - 2; i >= 1; i--) M[i] = d[i] - c[i] * M[i + 1];
      return M;
    }
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    const Mx = second(xs), My = second(ys);
    const out = [];
    const sub = 24;
    for (let i = 0; i < n - 1; i++) {
      const h = t[i + 1] - t[i];
      for (let s = 0; s < sub; s++) {
        const u = s / sub, A = 1 - u, B = u;
        const f = (v, M) => A * v[i] + B * v[i + 1] + ((A * A * A - A) * M[i] + (B * B * B - B) * M[i + 1]) * h * h / 6;
        out.push([f(xs, Mx), f(ys, My)]);
      }
    }
    out.push(P[n - 1]);
    return out;
  }

  // Entity -> Pfade [{pts, closed}] (Koordinaten in Zeichnungseinheiten, transformiert)
  function entityPaths(ent, m, blocks, layerOk, depth, out) {
    const ext = getNum(ent, 230, 1);
    const ocs = ext < 0 ? mul(m, [-1, 0, 0, 1, 0, 0]) : m;
    const T = (pts) => pts.map(p => ap(ocs, p[0], p[1]));

    switch (ent.type) {
      case 'LINE': {
        out.push({ pts: T([[getNum(ent, 10, 0), getNum(ent, 20, 0)], [getNum(ent, 11, 0), getNum(ent, 21, 0)]]), closed: false });
        break;
      }
      case 'CIRCLE': {
        const r = getNum(ent, 40, 0);
        if (r > 0) {
          const pts = arcPoints(getNum(ent, 10, 0), getNum(ent, 20, 0), r, 0, 2 * Math.PI, true);
          pts.pop();
          out.push({ pts: T(pts), closed: true });
        }
        break;
      }
      case 'ARC': {
        const r = getNum(ent, 40, 0);
        const a0 = getNum(ent, 50, 0) * Math.PI / 180;
        let a1 = getNum(ent, 51, 360) * Math.PI / 180;
        let sweep = a1 - a0;
        while (sweep <= 1e-12) sweep += 2 * Math.PI;
        if (r > 0) {
          const pts = arcPoints(getNum(ent, 10, 0), getNum(ent, 20, 0), r, a0, sweep, true);
          if (Math.abs(sweep - 2 * Math.PI) < 1e-9) { pts.pop(); out.push({ pts: T(pts), closed: true }); }
          else out.push({ pts: T(pts), closed: false });
        }
        break;
      }
      case 'ELLIPSE': {
        const cx = getNum(ent, 10, 0), cy = getNum(ent, 20, 0);
        const mx = getNum(ent, 11, 1), my = getNum(ent, 21, 0);
        const ratio = getNum(ent, 40, 1);
        const t0 = getNum(ent, 41, 0);
        let t1 = getNum(ent, 42, 2 * Math.PI);
        let sweep = t1 - t0;
        while (sweep <= 1e-12) sweep += 2 * Math.PI;
        const R = Math.hypot(mx, my);
        const vx = -my * ratio, vy = mx * ratio;
        const n = arcSegments(R, sweep);
        const full = Math.abs(sweep - 2 * Math.PI) < 1e-9;
        const pts = [];
        for (let k = 0; k <= (full ? n - 1 : n); k++) {
          const t = t0 + sweep * k / n;
          pts.push([cx + mx * Math.cos(t) + vx * Math.sin(t), cy + my * Math.cos(t) + vy * Math.sin(t)]);
        }
        // ELLIPSE liegt in WCS (Extrusion beeinflusst nur Richtung), daher m statt ocs
        out.push({ pts: pts.map(p => ap(ext < 0 ? mul(m, [-1, 0, 0, 1, 0, 0]) : m, ext < 0 ? -p[0] : p[0], p[1])), closed: full });
        break;
      }
      case 'LWPOLYLINE': {
        const flags = getNum(ent, 70, 0);
        const verts = [];
        for (const [c, v] of ent.p) {
          if (c === 10) verts.push({ x: parseFloat(v), y: 0, b: 0 });
          else if (c === 20 && verts.length) verts[verts.length - 1].y = parseFloat(v);
          else if (c === 42 && verts.length) verts[verts.length - 1].b = parseFloat(v);
        }
        pushPoly(verts, (flags & 1) === 1, T, out);
        break;
      }
      case 'POLYLINE': {
        const flags = getNum(ent, 70, 0);
        if (flags & (16 | 64)) break; // Netze ignorieren
        const verts = [];
        for (const v of ent.vertices || []) {
          const vf = getNum(v, 70, 0);
          if (vf & 16) continue; // Spline-Steuerpunkte
          verts.push({ x: getNum(v, 10, 0), y: getNum(v, 20, 0), b: getNum(v, 42, 0) });
        }
        pushPoly(verts, (flags & 1) === 1, T, out);
        break;
      }
      case 'SPLINE': {
        const flags = getNum(ent, 70, 0);
        const deg = getNum(ent, 71, 3);
        const knots = [], weights = [], ctrl = [], fit = [];
        for (const [c, v] of ent.p) {
          const f = parseFloat(v);
          if (c === 40) knots.push(f);
          else if (c === 41) weights.push(f);
          else if (c === 10) ctrl.push([f, 0]);
          else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1][1] = f;
          else if (c === 11) fit.push([f, 0]);
          else if (c === 21 && fit.length) fit[fit.length - 1][1] = f;
        }
        let pts = evalSpline(deg, knots, ctrl, weights);
        if (!pts) pts = fit.length >= 3 ? interpFit(fit, (flags & 1) === 1) : (fit.length >= 2 ? fit : ctrl);
        if (pts.length >= 2) {
          let closed = (flags & 1) === 1;
          const a = pts[0], b = pts[pts.length - 1];
          if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) { pts = pts.slice(0, -1); closed = true; }
          out.push({ pts: T(pts), closed });
        }
        break;
      }
      case 'INSERT': {
        if (depth > 10) break;
        const blk = blocks[getStr(ent, 2, '')];
        if (!blk) break;
        const sx = getNum(ent, 41, 1), sy = getNum(ent, 42, 1);
        const rot = getNum(ent, 50, 0) * Math.PI / 180;
        const cols = Math.max(1, getNum(ent, 70, 1)), rows = Math.max(1, getNum(ent, 71, 1));
        const cdx = getNum(ent, 44, 0), rdy = getNum(ent, 45, 0);
        const cos = Math.cos(rot), sin = Math.sin(rot);
        for (let rr = 0; rr < rows; rr++) {
          for (let cc = 0; cc < cols; cc++) {
            const ox = cc * cdx, oy = rr * rdy;
            const ix = getNum(ent, 10, 0) + cos * ox - sin * oy;
            const iy = getNum(ent, 20, 0) + sin * ox + cos * oy;
            let local = [1, 0, 0, 1, -blk.base[0], -blk.base[1]];
            local = mul([sx, 0, 0, sy, 0, 0], local);
            local = mul([cos, sin, -sin, cos, ix, iy], local);
            const mm = mul(ocs, local);
            for (const be of blk.ents) {
              // Im Block: nur Objekte auf dem Ziel-Layer bzw. Layer "0" (erbt vom INSERT)
              const bl = getStr(be, 8, '0');
              if (!(layerOk(bl) || bl === '0')) continue;
              entityPaths(be, mm, blocks, layerOk, depth + 1, out);
            }
          }
        }
        break;
      }
      default: break;
    }
  }

  function pushPoly(verts, closedFlag, T, out) {
    if (verts.length < 2) return;
    let closed = closedFlag;
    const a = verts[0], b = verts[verts.length - 1];
    if (!closed && verts.length > 2 && Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) {
      verts = verts.slice(0, -1);
      closed = true;
    }
    let pts = bulgePolyline(verts, closed);
    if (closed && pts.length > 1) {
      const f = pts[0], l = pts[pts.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-9) pts.pop();
    }
    out.push({ pts: T(pts), closed });
  }

  // ---------- Konturen bilden ----------
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;

  function dedupeOpen(paths) {
    const seen = new Set();
    const r = (p) => Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000);
    return paths.filter(p => {
      const a = r(p.pts[0]), b = r(p.pts[p.pts.length - 1]), m = r(p.pts[Math.floor(p.pts.length / 2)]);
      const key = (a < b ? a + '|' + b : b + '|' + a) + '|' + m + '|' + p.pts.length;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function chain(openPaths, tol) {
    const tol2 = tol * tol;
    const loops = [], unclosed = [];
    const used = new Array(openPaths.length).fill(false);
    const cell = tol * 2;
    const grid = new Map();
    const key = (p) => Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell);
    openPaths.forEach((p, idx) => {
      for (const end of [0, 1]) {
        const pt = end ? p.pts[p.pts.length - 1] : p.pts[0];
        const k = key(pt);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([idx, end]);
      }
    });
    function findNear(pt) {
      const cx = Math.floor(pt[0] / cell), cy = Math.floor(pt[1] / cell);
      let best = null, bestD = tol2;
      for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
        const lst = grid.get(ix + ',' + iy);
        if (!lst) continue;
        for (const [idx, end] of lst) {
          if (used[idx]) continue;
          const p = openPaths[idx].pts;
          const q = end ? p[p.length - 1] : p[0];
          const dd = d2(pt, q);
          if (dd <= bestD) { bestD = dd; best = [idx, end]; }
        }
      }
      return best;
    }
    for (let s = 0; s < openPaths.length; s++) {
      if (used[s]) continue;
      used[s] = true;
      let pts = openPaths[s].pts.slice();
      let reversedOnce = false;
      for (;;) {
        if (pts.length > 2 && d2(pts[0], pts[pts.length - 1]) <= tol2) {
          pts.pop();
          loops.push(pts);
          break;
        }
        const nb = findNear(pts[pts.length - 1]);
        if (nb) {
          used[nb[0]] = true;
          let add = openPaths[nb[0]].pts;
          if (nb[1] === 1) add = add.slice().reverse();
          for (let k = 1; k < add.length; k++) pts.push(add[k]);
          continue;
        }
        if (!reversedOnce) { reversedOnce = true; pts.reverse(); continue; }
        unclosed.push(pts);
        break;
      }
    }
    return { loops, unclosed };
  }

  function polyArea(pts) {
    let a = 0;
    for (let k = 0, n = pts.length; k < n; k++) {
      const p = pts[k], q = pts[(k + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }

  function pointInPoly(pt, pts) {
    let inside = false;
    const x = pt[0], y = pt[1];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function contains(outer, inner) {
    const b = outer.bb, c = inner.bb;
    if (c[0] < b[0] - 1e-6 || c[1] < b[1] - 1e-6 || c[2] > b[2] + 1e-6 || c[3] > b[3] + 1e-6) return false;
    const n = inner.pts.length, samples = Math.min(7, n);
    let votes = 0;
    for (let k = 0; k < samples; k++) if (pointInPoly(inner.pts[Math.floor(k * n / samples)], outer.pts)) votes++;
    return votes * 2 > samples;
  }

  /**
   * Berechnet die Fläche einer DXF-Datei.
   * @param {string} text DXF-Inhalt
   * @param {object} opts { layer: "0" }
   * @returns {{area:number, width:number, height:number, outer:number, holes:number, unclosed:number, loops:Array, unitFactor:number, warnings:string[]}}
   */
  function computeArea(text, opts) {
    opts = opts || {};
    const wanted = String(opts.layer == null ? '0' : opts.layer).trim().toUpperCase();
    const layerOk = (l) => String(l).trim().toUpperCase() === wanted;
    const dxf = parseDxf(text);
    const f = UNIT_TO_MM[dxf.insunits] || 1;
    const paths = [];
    for (const e of dxf.entities) {
      if (!layerOk(getStr(e, 8, '0'))) continue;
      entityPaths(e, IDENT, dxf.blocks, layerOk, 0, paths);
    }
    // in mm umrechnen
    for (const p of paths) p.pts = p.pts.map(q => [q[0] * f, q[1] * f]);

    const closed = paths.filter(p => p.closed && p.pts.length >= 3).map(p => p.pts);
    const open = dedupeOpen(paths.filter(p => !p.closed && p.pts.length >= 2));
    const ch = chain(open, JOIN_TOL);
    let loops = closed.concat(ch.loops).map(pts => {
      const a = polyArea(pts);
      return { pts, area: Math.abs(a), bb: bbox(pts) };
    }).filter(l => l.area > 1e-6);

    // doppelte Konturen entfernen
    loops.sort((a, b) => b.area - a.area);
    const uniq = [];
    for (const l of loops) {
      const dup = uniq.some(u => Math.abs(u.area - l.area) <= 1e-6 * Math.max(1, u.area) + 1e-3 &&
        u.bb.every((v, k) => Math.abs(v - l.bb[k]) < JOIN_TOL));
      if (!dup) uniq.push(l);
    }
    loops = uniq;

    // Verschachtelungstiefe: gerade = Material, ungerade = Loch
    let area = 0, outer = 0, holes = 0;
    for (let k = 0; k < loops.length; k++) {
      let depth = 0;
      for (let j = 0; j < k; j++) if (contains(loops[j], loops[k])) depth++;
      loops[k].depth = depth;
      if (depth % 2 === 0) { area += loops[k].area; outer++; } else { area -= loops[k].area; holes++; }
    }

    const warnings = [];
    if (!loops.length) warnings.push('Keine geschlossene Kontur auf Layer "' + (opts.layer == null ? '0' : opts.layer) + '" gefunden.');
    if (ch.unclosed.length) warnings.push(ch.unclosed.length + ' offene Kontur(en) ignoriert.');
    if (outer > 1) warnings.push(outer + ' getrennte Außenkonturen gefunden.');

    let bb = [0, 0, 0, 0];
    if (loops.length) {
      bb = loops.filter(l => l.depth === 0).map(l => l.bb).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    }
    return {
      area, outer, holes,
      width: bb[2] - bb[0], height: bb[3] - bb[1], bbox: bb,
      unclosed: ch.unclosed.length,
      loops: loops.map(l => ({ pts: l.pts, depth: l.depth })),
      unitFactor: f,
      warnings
    };
  }

  // ---------- Dateiname ----------
  /**
   * "5x_Pos_123_10mm.dxf" -> {qty:5, pos:"123", thickness:10}
   */
  function parseFileName(name) {
    const base = name.replace(/^.*[\\/]/, '').replace(/\.dxf$/i, '');
    const res = { qty: null, pos: null, thickness: null };
    let m = base.match(/(?:^|[_\s-])(\d+)\s*(?:x|stk\.?|st\.?|stück|stueck)(?=[_\s-]|$)/i);
    if (m) res.qty = parseInt(m[1], 10);
    m = base.match(/pos(?:ition)?\.?[_\s-]*([^_\s]+)/i);
    if (m) res.pos = m[1];
    m = base.match(/(\d+(?:[.,]\d+)?)\s*mm(?=[_\s-]|$)/i);
    if (m) res.thickness = parseFloat(m[1].replace(',', '.'));
    return res;
  }

  const api = { computeArea, parseFileName, parseDxf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DxfArea = api;
})(typeof window !== 'undefined' ? window : this);
