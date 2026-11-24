(function () {
  'use strict';

  const MATERIALS = [
    { name: 'Stahl (S235/S355)', d: 7.85 },
    { name: 'Edelstahl (1.4301)', d: 7.90 },
    { name: 'Edelstahl (1.4571)', d: 7.98 },
    { name: 'Aluminium', d: 2.70 },
    { name: 'Kupfer', d: 8.96 },
    { name: 'Messing', d: 8.50 },
    { name: 'Titan', d: 4.51 },
    { name: 'Benutzerdefiniert', d: null }
  ];
  const STORE = 'dxfgewicht.settings.v1';

  const $ = (id) => document.getElementById(id);
  const el = {
    dir: $('dirInput'), files: $('fileInput'), clear: $('clearBtn'), drop: $('drop'), status: $('status'),
    order: $('order'), priceHole: $('priceHole'), priceSlot: $('priceSlot'), byThk: $('byThk'),
    material: $('material'), density: $('density'), scrap: $('scrap'), cost: $('cost'), costUnit: $('costUnit'), layer: $('layer'),
    tbody: $('tbody'), tfoot: $('tfoot'), empty: $('empty'), summary: $('summary'),
    csv: $('csvBtn'), print: $('printBtn'), printinfo: $('printinfo')
  };

  let rows = []; // {id, file, text, pos, qty, thk, res, error}
  let nextId = 1;

  // ---------- Zahlen ----------
  const num = (s) => {
    if (s == null) return NaN;
    s = String(s).trim().replace(/\s/g, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
    return parseFloat(s.replace(',', '.'));
  };
  const fmt = (v, dec) => isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '–';
  const dims = (arr) => {
    const cnt = new Map();
    arr.forEach(a => cnt.set(a, (cnt.get(a) || 0) + 1));
    return '(' + Array.from(cnt).map(([k, n]) => (n > 1 ? n + '× ' : '') + k).join(', ') + ')';
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- Einstellungen ----------
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { s = {}; }
    MATERIALS.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = m.d ? `${m.name} – ${fmt(m.d, 2)}` : m.name;
      el.material.appendChild(o);
    });
    el.material.value = s.material != null ? s.material : 0;
    el.density.value = s.density || fmt(MATERIALS[0].d, 2);
    el.scrap.value = s.scrap != null ? s.scrap : '10';
    el.cost.value = s.cost != null ? s.cost : '0';
    el.costUnit.value = s.costUnit || 'kg';
    el.layer.value = s.layer != null ? s.layer : '0';
    el.priceHole.value = s.priceHole != null ? s.priceHole : '0';
    el.priceSlot.value = s.priceSlot != null ? s.priceSlot : '0';
  }
  function saveSettings() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        material: el.material.value, density: el.density.value, scrap: el.scrap.value,
        cost: el.cost.value, costUnit: el.costUnit.value, layer: el.layer.value,
        priceHole: el.priceHole.value, priceSlot: el.priceSlot.value
      }));
    } catch (e) { /* ignorieren */ }
  }

  el.material.addEventListener('change', () => {
    const m = MATERIALS[+el.material.value];
    if (m.d) el.density.value = fmt(m.d, 2);
    saveSettings(); render();
  });
  el.density.addEventListener('input', () => {
    const d = num(el.density.value);
    const idx = MATERIALS.findIndex(m => m.d && Math.abs(m.d - d) < 1e-9);
    el.material.value = idx >= 0 ? idx : MATERIALS.length - 1;
    saveSettings(); render();
  });
  [el.scrap, el.cost, el.priceHole, el.priceSlot].forEach(i => i.addEventListener('input', () => { saveSettings(); renderSummary(); }));
  el.costUnit.addEventListener('change', () => { saveSettings(); renderSummary(); });
  el.layer.addEventListener('change', () => { saveSettings(); recomputeAll(); });
  let orderAuto = true; // Auftragsname wird automatisch gesetzt, solange nicht von Hand geändert
  el.order.addEventListener('input', () => { orderAuto = !el.order.value.trim(); renderSummary(); });

  function setOrderFromFiles(files) {
    if (!orderAuto) return;
    for (const f of files) {
      const p = (f.webkitRelativePath || f.relPath || '').split('/');
      if (p.length > 1 && p[0]) { el.order.value = p[0]; return; }
    }
  }

  // ---------- Dateien laden ----------
  async function addFiles(fileList) {
    const files = Array.from(fileList).filter(f => /\.dxf$/i.test(f.name));
    if (!files.length) { setStatus('Keine DXF-Dateien gefunden.'); return; }
    setOrderFromFiles(files);
    setStatus(`Lese ${files.length} Datei(en) …`);
    let n = 0;
    for (const f of files) {
      const path = f.webkitRelativePath || f.relPath || f.name;
      if (rows.some(r => r.path === path && r.size === f.size)) continue; // doppelt
      const text = await f.text();
      const meta = DxfArea.parseFileName(f.name);
      const row = {
        id: nextId++, name: f.name, path, size: f.size, text,
        pos: meta.pos || f.name.replace(/\.dxf$/i, ''),
        qty: meta.qty != null ? meta.qty : 1,
        thk: meta.thickness,
        qtyFromName: meta.qty != null
      };
      compute(row);
      rows.push(row);
      n++;
      if (n % 10 === 0) { setStatus(`Lese … ${n}/${files.length}`); await new Promise(r => setTimeout(r)); }
    }
    sortRows();
    const errs = rows.filter(r => r.error).length;
    setStatus(`${n} Datei(en) geladen. ${rows.length} Positionen gesamt.` + (errs ? ` ${errs} mit Fehler.` : ''));
    render();
  }

  function compute(row) {
    try {
      row.res = DxfArea.computeArea(row.text, { layer: el.layer.value });
      row.error = row.res.loops.length ? null : row.res.warnings[0];
      row.nHole = row.res.round;
      row.nSlot = row.res.slots;
    } catch (e) {
      row.res = null;
      row.error = e.message || String(e);
      row.nHole = 0; row.nSlot = 0;
    }
  }
  function recomputeAll() { rows.forEach(compute); render(); }

  function sortRows() {
    rows.sort((a, b) => String(a.pos).localeCompare(String(b.pos), 'de', { numeric: true, sensitivity: 'base' }) ||
      a.name.localeCompare(b.name, 'de', { numeric: true }));
  }

  el.dir.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  el.files.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  el.clear.addEventListener('click', () => {
    rows = []; setStatus('');
    if (orderAuto) el.order.value = '';
    render();
  });

  // Drag & Drop inkl. Ordner
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => document.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || e.target === el.drop) el.drop.classList.remove('over'); }));
  document.addEventListener('drop', async (e) => {
    const items = e.dataTransfer && e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const entries = Array.from(items).map(i => i.webkitGetAsEntry()).filter(Boolean);
      const out = [];
      await Promise.all(entries.map(en => walk(en, '', out)));
      addFiles(out);
    } else if (e.dataTransfer) addFiles(e.dataTransfer.files);
  });
  function walk(entry, prefix, out) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(f => { f.relPath = prefix + f.name; out.push(f); resolve(); }, () => resolve());
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const read = () => reader.readEntries(async (ents) => {
          if (!ents.length) {
            await Promise.all(all.map(en => walk(en, prefix + entry.name + '/', out)));
            resolve();
          } else { all.push(...ents); read(); }
        }, () => resolve());
        read();
      } else resolve();
    });
  }

  function setStatus(t) { el.status.textContent = t; }

  // ---------- Berechnung ----------
  function calcRow(r) {
    const dens = num(el.density.value);
    const area = r.res && !r.error ? r.res.area : NaN; // mm²
    const kgPc = area * r.thk * dens / 1e6;            // mm²·mm = mm³; /1000 = cm³; ·g/cm³ = g; /1000 = kg
    return { area, kgPc, kgTot: kgPc * r.qty };
  }

  function totals() {
    let kg = 0, pcs = 0, areaTot = 0, bad = 0, holes = 0, slots = 0;
    const scrapP = num(el.scrap.value) || 0;
    const groups = new Map(); // Materialstärke -> Summen
    for (const r of rows) {
      const c = calcRow(r);
      holes += (r.nHole || 0) * r.qty;
      slots += (r.nSlot || 0) * r.qty;
      if (isFinite(c.kgTot)) {
        kg += c.kgTot; pcs += r.qty; areaTot += c.area * r.qty;
        const g = groups.get(r.thk) || { thk: r.thk, pos: 0, pcs: 0, kg: 0, area: 0 };
        g.pos++; g.pcs += r.qty; g.kg += c.kgTot; g.area += c.area * r.qty;
        groups.set(r.thk, g);
      } else bad++;
    }
    const byThk = Array.from(groups.values()).sort((a, b) => b.thk - a.thk);
    byThk.forEach(g => { g.gross = g.kg * (1 + scrapP / 100); });
    const scrapKg = kg * scrapP / 100;
    const gross = kg + scrapKg;
    const price = num(el.cost.value) || 0;
    const perKg = el.costUnit.value === 't' ? price / 1000 : price;
    const pHole = num(el.priceHole.value) || 0, pSlot = num(el.priceSlot.value) || 0;
    const matCost = gross * perKg, holeCost = holes * pHole, slotCost = slots * pSlot;
    return {
      kg, pcs, areaTot, bad, scrapP, scrapKg, gross, price, perKg, byThk,
      holes, slots, pHole, pSlot, matCost, holeCost, slotCost, cost: matCost + holeCost + slotCost
    };
  }

  // ---------- Darstellung ----------
  function thumb(res) {
    if (!res || !res.loops.length) return '';
    const [x0, y0, x1, y1] = res.bbox;
    const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
    const pathOf = (l) => {
      const step = Math.max(1, Math.floor(l.pts.length / 400));
      let d = 'M';
      for (let k = 0; k < l.pts.length; k += step) {
        const p = l.pts[k];
        d += (p[0] - x0).toFixed(2) + ' ' + (y1 - p[1]).toFixed(2) + ' ';
      }
      return d + 'Z';
    };
    const all = res.loops.map(pathOf).join('');
    const hr = res.loops.filter(l => l.hole === 'rund').map(pathOf).join('');
    const hl = res.loops.filter(l => l.hole === 'lang').map(pathOf).join('');
    const pad = Math.max(w, h) * 0.04;
    return `<svg class="thumb" viewBox="${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}" preserveAspectRatio="xMidYMid meet"><path d="${all}"/>` +
      (hr ? `<path class="h-rund" d="${hr}"/>` : '') + (hl ? `<path class="h-lang" d="${hl}"/>` : '') + '</svg>';
  }

  function render() {
    el.empty.style.display = rows.length ? 'none' : '';
    el.tbody.innerHTML = rows.map(r => {
      const c = calcRow(r);
      const warns = [];
      if (r.error) warns.push({ t: r.error, cls: 'warn err' });
      else if (r.res) {
        r.res.warnings.forEach(w => warns.push({ t: w, cls: 'warn' }));
        if (r.res.holes) {
          const parts = [];
          if (r.res.round) parts.push(`${r.res.round} Bohrung(en) ` + dims(r.res.holeList.filter(h => h.type === 'rund').map(h => 'Ø' + fmt(h.d, 1))));
          if (r.res.slots) parts.push(`${r.res.slots} Langloch/-löcher ` + dims(r.res.holeList.filter(h => h.type === 'lang').map(h => fmt(h.l, 1) + '×' + fmt(h.w, 1))));
          if (r.res.other) parts.push(`${r.res.other} sonstige(r) Ausschnitt(e)`);
          warns.push({ t: parts.join(' · '), cls: 'info' });
        }
      }
      if (!r.qtyFromName) warns.push({ t: 'Stückzahl nicht im Dateinamen – bitte prüfen', cls: 'warn' });
      const thkBad = !(r.thk > 0);
      return `<tr data-id="${r.id}" class="${r.error ? 'errrow' : ''}">
        <td class="noprint c-thumb">${thumb(r.res)}</td>
        <td class="c-pos" data-l="Position"><input class="pos" data-f="pos" value="${esc(r.pos)}"></td>
        <td class="file c-file" title="${esc(r.path)}">${esc(r.name)}${warns.map(w => `<span class="${w.cls}">${esc(w.t)}</span>`).join('')}</td>
        <td class="num c-qty" data-l="Stück"><input class="qty" data-f="qty" inputmode="numeric" value="${r.qty}"></td>
        <td class="num c-thk" data-l="Stärke mm"><input class="thk ${thkBad ? 'bad' : ''}" data-f="thk" inputmode="decimal" value="${r.thk != null ? fmt(r.thk, r.thk % 1 ? 2 : 0) : ''}" placeholder="mm"></td>
        <td class="num c-hole" data-l="Bohrungen/Stk"><input class="cnt" data-f="nHole" inputmode="numeric" value="${r.nHole || 0}"></td>
        <td class="num c-slot" data-l="Langlöcher/Stk"><input class="cnt" data-f="nSlot" inputmode="numeric" value="${r.nSlot || 0}"></td>
        <td class="num c-dim" data-l="Abmessung mm">${r.res && !r.error ? fmt(r.res.width, 1) + ' × ' + fmt(r.res.height, 1) : '–'}</td>
        <td class="num c-area" data-l="Fläche/Stk m²">${fmt(c.area / 1e6, 4)}</td>
        <td class="num c-pc" data-l="Gewicht/Stk kg">${fmt(c.kgPc, 3)}</td>
        <td class="num c-tot" data-l="Gesamt kg"><b>${fmt(c.kgTot, 2)}</b></td>
        <td class="noprint c-del"><button class="del" title="Entfernen" data-del="${r.id}">✕</button></td>
      </tr>`;
    }).join('');
    renderSummary();
  }

  function renderSummary() {
    const t = totals();
    el.tfoot.innerHTML = rows.length ? `<tr>
      <td class="noprint"></td><td colspan="2">Summe (${rows.length} Pos.)</td>
      <td class="num">${t.pcs}</td><td></td>
      <td class="num" title="Bohrungen gesamt">${t.holes}</td><td class="num" title="Langlöcher gesamt">${t.slots}</td><td></td>
      <td class="num">${fmt(t.areaTot / 1e6, 3)}</td><td></td>
      <td class="num">${fmt(t.kg, 2)}</td><td class="noprint"></td></tr>` : '';
    // Live-Update der Zeilenwerte ohne Neuaufbau (Fokus bleibt in Eingabefeldern)
    el.tbody.querySelectorAll('tr').forEach(tr => {
      const r = rows.find(x => x.id === +tr.dataset.id);
      if (!r) return;
      const c = calcRow(r);
      tr.querySelector('.c-area').textContent = fmt(c.area / 1e6, 4);
      tr.querySelector('.c-pc').textContent = fmt(c.kgPc, 3);
      tr.querySelector('.c-tot').innerHTML = `<b>${fmt(c.kgTot, 2)}</b>`;
    });
    const unit = el.costUnit.value === 't' ? 't' : 'kg';
    el.summary.innerHTML = `
      <div>Gesamtgewicht Bauteile (${t.pcs} Stk.)</div><div class="v">${fmt(t.kg, 2)} kg</div>
      <div>Verschnitt ${fmt(t.scrapP, t.scrapP % 1 ? 1 : 0)} %</div><div class="v">+ ${fmt(t.scrapKg, 2)} kg</div>
      <div class="total">Gesamtgewicht inkl. Verschnitt</div><div class="v total">${fmt(t.gross, 2)} kg</div>
      <div class="sep"></div>
      <div>Material: ${fmt(t.gross, 2)} kg × ${fmt(t.price, 2)} €/${unit}</div><div class="v">${fmt(t.matCost, 2)} €</div>
      <div>Bohrungen: ${t.holes} Stk × ${fmt(t.pHole, 2)} €</div><div class="v">${fmt(t.holeCost, 2)} €</div>
      <div>Langlöcher: ${t.slots} Stk × ${fmt(t.pSlot, 2)} €</div><div class="v">${fmt(t.slotCost, 2)} €</div>
      <div class="total">Gesamtpreis</div><div class="v total cost">${fmt(t.cost, 2)} €</div>
      ${t.bad ? `<div class="err" style="grid-column:1/-1">⚠ ${t.bad} Position(en) ohne gültige Fläche/Stärke sind nicht im Gewicht enthalten.</div>` : ''}`;
    el.byThk.innerHTML = t.byThk.length ? `<thead><tr><th class="num">Stärke</th><th class="num">Pos.</th><th class="num">Stück</th><th class="num c-a">Fläche m²</th><th class="num">Gewicht kg</th><th class="num">inkl. Verschnitt kg</th></tr></thead>
      <tbody>${t.byThk.map(g => `<tr><td class="num"><b>${fmt(g.thk, g.thk % 1 ? 2 : 0)} mm</b></td><td class="num">${g.pos}</td><td class="num">${g.pcs}</td>
        <td class="num c-a">${fmt(g.area / 1e6, 3)}</td><td class="num">${fmt(g.kg, 2)}</td><td class="num"><b>${fmt(g.gross, 2)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Summe</td><td class="num">${t.byThk.reduce((a, g) => a + g.pos, 0)}</td><td class="num">${t.pcs}</td>
        <td class="num c-a">${fmt(t.areaTot / 1e6, 3)}</td><td class="num">${fmt(t.kg, 2)}</td><td class="num">${fmt(t.gross, 2)}</td></tr></tfoot>`
      : '<tbody><tr><td class="muted">–</td></tr></tbody>';
    const m = MATERIALS[+el.material.value];
    const order = el.order.value.trim();
    el.printinfo.innerHTML = `<b style="font-size:18px">${order ? 'Auftrag: ' + esc(order) : 'DXF Gewichtsberechnung'}</b><br>${new Date().toLocaleDateString('de-DE')}<br>
      Material: ${esc(m.d ? m.name : 'Benutzerdefiniert')}, spez. Gewicht ${esc(el.density.value)} kg/dm³`;
  }

  el.tbody.addEventListener('input', (e) => {
    const inp = e.target, f = inp.dataset.f;
    if (!f) return;
    const r = rows.find(x => x.id === +inp.closest('tr').dataset.id);
    if (f === 'pos') r.pos = inp.value;
    else if (f === 'qty') { r.qty = Math.max(0, Math.round(num(inp.value) || 0)); r.qtyFromName = true; }
    else if (f === 'thk') { r.thk = num(inp.value); inp.classList.toggle('bad', !(r.thk > 0)); }
    else if (f === 'nHole' || f === 'nSlot') r[f] = Math.max(0, Math.round(num(inp.value) || 0));
    renderSummary();
  });
  el.tbody.addEventListener('click', (e) => {
    const id = e.target.dataset && e.target.dataset.del;
    if (!id) return;
    rows = rows.filter(r => r.id !== +id);
    render();
  });

  // ---------- Export ----------
  el.csv.addEventListener('click', () => {
    if (!rows.length) return;
    const t = totals();
    const c = (v, d) => isFinite(v) ? v.toFixed(d).replace('.', ',') : '';
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const order = el.order.value.trim();
    const E = (label, val) => ['', q(label), '', '', '', '', '', '', '', '', val].join(';');
    const lines = [];
    if (order) lines.push(['Auftrag', q(order)].join(';'), '');
    lines.push(['Pos', 'Datei', 'Stück', 'Stärke mm', 'Bohrungen/Stk', 'Langlöcher/Stk', 'Breite mm', 'Höhe mm', 'Fläche/Stk m²', 'Gewicht/Stk kg', 'Gesamt kg'].join(';'));
    for (const r of rows) {
      const k = calcRow(r);
      lines.push([q(r.pos), q(r.name), r.qty, c(r.thk, 2), r.nHole || 0, r.nSlot || 0, r.res ? c(r.res.width, 1) : '', r.res ? c(r.res.height, 1) : '',
        c(k.area / 1e6, 6), c(k.kgPc, 3), c(k.kgTot, 3)].join(';'));
    }
    lines.push('', 'Zusammenfassung nach Materialstärke', ['Stärke mm', 'Positionen', 'Stück', 'Fläche m²', 'Gewicht kg', 'inkl. Verschnitt kg'].join(';'));
    for (const g of t.byThk) lines.push([c(g.thk, 2), g.pos, g.pcs, c(g.area / 1e6, 4), c(g.kg, 3), c(g.gross, 3)].join(';'));
    lines.push('');
    lines.push(E('Gesamtgewicht Bauteile (' + t.pcs + ' Stk)', c(t.kg, 3)));
    lines.push(E('Verschnitt ' + c(t.scrapP, 1) + ' %', c(t.scrapKg, 3)));
    lines.push(E('Gesamtgewicht inkl. Verschnitt', c(t.gross, 3)));
    lines.push(E('Materialkosten (' + c(t.price, 2) + ' €/' + el.costUnit.value + ')', c(t.matCost, 2)));
    lines.push(E('Bohrungen ' + t.holes + ' Stk × ' + c(t.pHole, 2) + ' €', c(t.holeCost, 2)));
    lines.push(E('Langlöcher ' + t.slots + ' Stk × ' + c(t.pSlot, 2) + ' €', c(t.slotCost, 2)));
    lines.push(E('Gesamtpreis €', c(t.cost, 2)));
    lines.push(E('Spez. Gewicht kg/dm³', c(num(el.density.value), 3)));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safe = order.replace(/[\\/:*?"<>|]+/g, '_');
    a.download = (safe ? safe + '_' : 'DXF_Gewicht_') + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  el.print.addEventListener('click', () => window.print());

  // ---------- Start ----------
  loadSettings();
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
