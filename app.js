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
    order: $('order'), note: $('note'), bends: $('bends'), priceBend: $('priceBend'), dataPrep: $('dataPrep'),
    priceHole: $('priceHole'), priceSlot: $('priceSlot'), byThk: $('byThk'),
    material: $('material'), density: $('density'), scrap: $('scrap'), cost: $('cost'), costUnit: $('costUnit'), layer: $('layer'),
    tbody: $('tbody'), tfoot: $('tfoot'), empty: $('empty'), summary: $('summary'),
    csv: $('csvBtn'), pdf: $('pdfBtn'), print: $('printBtn'), printinfo: $('printinfo')
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
    el.priceBend.value = s.priceBend != null ? s.priceBend : '0';
    el.dataPrep.value = s.dataPrep != null ? s.dataPrep : '0';
    el.bends.value = '0';
  }
  function saveSettings() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        material: el.material.value, density: el.density.value, scrap: el.scrap.value,
        cost: el.cost.value, costUnit: el.costUnit.value, layer: el.layer.value,
        priceHole: el.priceHole.value, priceSlot: el.priceSlot.value,
        priceBend: el.priceBend.value, dataPrep: el.dataPrep.value
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
  [el.bends, el.note].forEach(i => i.addEventListener('input', () => renderSummary()));
  [el.scrap, el.cost, el.priceHole, el.priceSlot, el.priceBend, el.dataPrep].forEach(i => i.addEventListener('input', () => { saveSettings(); renderSummary(); }));
  el.costUnit.addEventListener('change', () => { saveSettings(); renderSummary(); });
  el.layer.addEventListener('change', () => { saveSettings(); recomputeAll(); });
  let orderAuto = true; // Auftragsname wird automatisch gesetzt, solange nicht von Hand geändert
  el.order.addEventListener('input', () => { orderAuto = !el.order.value.trim(); renderSummary(); });

  function resetOrderFields() { el.note.value = ''; el.bends.value = '0'; }

  function setOrderFromFiles(files) {
    if (!orderAuto) return;
    for (const f of files) {
      const p = (f.webkitRelativePath || f.relPath || '').split('/');
      if (p.length > 1 && p[0]) { el.order.value = p[0]; return; }
    }
  }

  // ---------- Dateien laden ----------
  // ---------- ZIP ----------
  // Windows-Explorer speichert Dateinamen in ZIPs meist im DOS-Zeichensatz (CP850)
  const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00AD±‗¾¶§÷¸°¨·¹³²■\u00A0';
  function fixName(n) {
    if (!/[\u0080-\u009F]/.test(n)) return n; // korrekt als UTF-8 gelesen
    return n.replace(/[\u0080-\u00FF]/g, ch => CP850[ch.charCodeAt(0) - 128]);
  }

  async function expandZip(zipFile) {
    if (!window.fflate) throw new Error('ZIP-Funktion konnte nicht geladen werden.');
    const buf = new Uint8Array(await zipFile.arrayBuffer());
    const entries = window.fflate.unzipSync(buf, {
      filter: (f) => /\.dxf$/i.test(f.name) && !/(^|\/)(__MACOSX\/|\._)/.test(f.name)
    });
    let names = Object.keys(entries).map(raw => ({ raw, path: fixName(raw).replace(/\\/g, '/') }));
    // gemeinsamer Oberordner im ZIP -> Auftragsname, sonst ZIP-Dateiname
    const tops = new Set(names.map(n => n.path.includes('/') ? n.path.split('/')[0] : ''));
    const zipBase = zipFile.name.replace(/\.zip$/i, '');
    let order = zipBase, strip = '';
    if (tops.size === 1 && !tops.has('')) { strip = [...tops][0] + '/'; order = [...tops][0]; }
    return names.map(n => {
      const rel = n.path.slice(strip.length);
      const f = new File([entries[n.raw]], rel.split('/').pop(), { type: 'application/dxf' });
      f.relPath = order + '/' + rel;
      f.zipOrder = order;
      return f;
    });
  }

  async function addFiles(fileList) {
    let input = Array.from(fileList);
    const zips = input.filter(f => /\.zip$/i.test(f.name) || /zip/i.test(f.type || ''));
    if (zips.length) {
      const fromZip = [];
      for (const z of zips) {
        try {
          setStatus(`Entpacke ${z.name} …`);
          fromZip.push(...await expandZip(z));
        } catch (e) {
          setStatus(`ZIP „${z.name}“ konnte nicht gelesen werden: ${e.message || e}`);
          return;
        }
      }
      if (!fromZip.length) { setStatus('Im ZIP wurden keine DXF-Dateien gefunden.'); return; }
      // ein ZIP = ein neuer Auftrag: bisherige Liste ersetzen
      rows = [];
      orderAuto = true;
      el.order.value = '';
      resetOrderFields();
      input = input.filter(f => !zips.includes(f)).concat(fromZip);
    }
    const files = input.filter(f => /\.dxf$/i.test(f.name));
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
    setStatus((zips.length ? `ZIP entpackt: ` : '') + `${n} Datei(en) geladen. ${rows.length} Positionen gesamt.` + (errs ? ` ${errs} mit Fehler.` : ''));
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
    resetOrderFields();
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
    const bends = Math.max(0, Math.round(num(el.bends.value) || 0)), pBend = num(el.priceBend.value) || 0;
    const bendCost = bends * pBend, prepCost = num(el.dataPrep.value) || 0;
    return {
      kg, pcs, areaTot, bad, scrapP, scrapKg, gross, price, perKg, byThk,
      holes, slots, pHole, pSlot, matCost, holeCost, slotCost, bends, pBend, bendCost, prepCost,
      cost: matCost + holeCost + slotCost + bendCost + prepCost
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
        <td class="c-thumb">${thumb(r.res)}</td>
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
      <td></td><td colspan="2">Summe (${rows.length} Pos.)</td>
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
      <div>Kantungen: ${t.bends} Stk × ${fmt(t.pBend, 2)} €</div><div class="v">${fmt(t.bendCost, 2)} €</div>
      <div>Datenaufbereitung</div><div class="v">${fmt(t.prepCost, 2)} €</div>
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
    const F = window.FIRMA || {};
    const adr = (F.adresse || []).filter(Boolean);
    const kopf = (F.logo || adr.length) ? `<div class="briefkopf">${F.logo ? `<img src="${F.logo}" alt="">` : '<span></span>'}` +
      `<div class="adr">${adr.map((l, i) => i === 0 ? `<b>${esc(l)}</b>` : esc(l)).join('<br>')}</div></div>` : '';
    el.printinfo.innerHTML = kopf + `<b style="font-size:18px">${order ? 'Auftrag: ' + esc(order) : 'DXF Gewichtsberechnung'}</b><br>${new Date().toLocaleDateString('de-DE')}<br>
      Material: ${esc(m.d ? m.name : 'Benutzerdefiniert')}, spez. Gewicht ${esc(el.density.value)} kg/dm³` +
      (el.note.value.trim() ? `<br><b>Notiz:</b> ${esc(el.note.value.trim())}` : '');
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
    if (order) lines.push(['Auftrag', q(order)].join(';'));
    if (el.note.value.trim()) lines.push(['Notiz', q(el.note.value.trim())].join(';'));
    if (order || el.note.value.trim()) lines.push('');
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
    lines.push(E('Kantungen ' + t.bends + ' Stk × ' + c(t.pBend, 2) + ' €', c(t.bendCost, 2)));
    lines.push(E('Datenaufbereitung €', c(t.prepCost, 2)));
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

  // ---------- PDF ----------
  function drawThumbPdf(doc, res, x, y, w, h) {
    if (!res || !res.loops.length) return;
    const [x0, y0, x1, y1] = res.bbox;
    const bw = Math.max(x1 - x0, 1e-6), bh = Math.max(y1 - y0, 1e-6);
    const sc = Math.min(w / bw, h / bh);
    const ox = x + (w - bw * sc) / 2, oy = y + (h - bh * sc) / 2;
    const P = (p) => [ox + (p[0] - x0) * sc, oy + (y1 - p[1]) * sc];
    const trace = (l) => {
      const step = Math.max(1, Math.floor(l.pts.length / 150));
      let first = true;
      for (let k = 0; k < l.pts.length; k += step) {
        const q = P(l.pts[k]);
        if (first) { doc.moveTo(q[0], q[1]); first = false; } else doc.lineTo(q[0], q[1]);
      }
      doc.close();
    };
    doc.setLineWidth(0.2);
    doc.setDrawColor(31, 78, 121);
    doc.setFillColor(219, 231, 243);
    res.loops.forEach(trace);
    doc.fillStrokeEvenOdd();
    for (const [type, col] of [['rund', [22, 163, 74]], ['lang', [217, 119, 6]]]) {
      const ls = res.loops.filter(l => l.hole === type);
      if (!ls.length) continue;
      doc.setLineWidth(0.4);
      doc.setDrawColor(col[0], col[1], col[2]);
      ls.forEach(trace);
      doc.stroke();
    }
  }

  function holeText(r) {
    if (!r.res || r.error) return r.error || '';
    const parts = [];
    const hl = r.res.holeList || [];
    if (r.res.round) parts.push(r.res.round + ' Bohr. ' + dims(hl.filter(h => h.type === 'rund').map(h => 'Ø' + fmt(h.d, 1))));
    if (r.res.slots) parts.push(r.res.slots + ' Langl. ' + dims(hl.filter(h => h.type === 'lang').map(h => fmt(h.l, 1) + '×' + fmt(h.w, 1))));
    if (r.res.other) parts.push(r.res.other + ' sonst. Ausschnitt(e)');
    return parts.join(', ');
  }

  function buildPdf() {
    const { jsPDF } = window.jspdf;
    const AT = window.jspdf_autotable || {};
    const autoTable = AT.autoTable || AT.default || ((d, o) => d.autoTable(o));
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const t = totals();
    const order = el.order.value.trim();
    const m = MATERIALS[+el.material.value];
    const unit = el.costUnit.value === 't' ? 't' : 'kg';
    const W = doc.internal.pageSize.getWidth();
    const M = 12;
    const blue = [31, 78, 121];

    // Briefkopf: Logo links, Adresse rechts (aus firma.js)
    const F = window.FIRMA || {};
    const adr = (F.adresse || []).filter(Boolean);
    let top = 10, headH = 0;
    if (F.logo) {
      try {
        const ip = doc.getImageProperties(F.logo);
        let lh = 20, lw = lh * ip.width / ip.height;
        if (lw > 75) { lw = 75; lh = lw * ip.height / ip.width; }
        doc.addImage(F.logo, ip.fileType, M, top, lw, lh);
        headH = lh;
      } catch (e) { /* Logo fehlerhaft -> ohne Logo */ }
    }
    if (adr.length) {
      doc.setFontSize(9);
      adr.forEach((line, i) => {
        doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
        doc.text(String(line), W - M, top + 3.5 + i * 4.2, { align: 'right' });
      });
      headH = Math.max(headH, adr.length * 4.2 + 1);
    }
    let ty = 16;
    if (headH) {
      const ly = top + headH + 3;
      doc.setDrawColor(31, 78, 121); doc.setLineWidth(0.4);
      doc.line(M, ly, W - M, ly);
      ty = ly + 8;
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(order ? 'Auftrag: ' + order : 'DXF Gewichtsberechnung', M, ty);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(new Date().toLocaleDateString('de-DE'), W - M, ty, { align: 'right' });
    doc.text(`Material: ${m.d ? m.name : 'Benutzerdefiniert'}  ·  spez. Gewicht ${el.density.value} kg/dm³  ·  Verschnitt ${fmt(t.scrapP, t.scrapP % 1 ? 1 : 0)} %  ·  ` +
      `Preis ${fmt(t.price, 2)} €/${unit}  ·  Bohrung ${fmt(t.pHole, 2)} €  ·  Langloch ${fmt(t.pSlot, 2)} €  ·  Kantung ${fmt(t.pBend, 2)} €`, M, ty + 6);
    const note = el.note.value.trim();
    if (note) {
      doc.setFont('helvetica', 'bold'); doc.text('Notiz:', M, ty + 11);
      doc.setFont('helvetica', 'normal');
      doc.text(doc.splitTextToSize(note, W - 2 * M - 12)[0], M + 11, ty + 11);
      ty += 5;
    }

    const head = [['Bild', 'Pos.', 'Datei / Ausschnitte', 'Stück', 'Stärke\nmm', 'Bohr.\n/Stk', 'Langl.\n/Stk', 'Abmessung\nmm', 'Fläche/Stk\nm²', 'Gewicht/Stk\nkg', 'Gesamt\nkg']];
    const body = rows.map(r => {
      const c = calcRow(r);
      const info = holeText(r);
      return ['', String(r.pos), r.name + (info ? '\n' + info : ''), r.qty, r.thk > 0 ? fmt(r.thk, r.thk % 1 ? 2 : 0) : '–',
        r.nHole || 0, r.nSlot || 0,
        r.res && !r.error ? fmt(r.res.width, 1) + ' × ' + fmt(r.res.height, 1) : '–',
        fmt(c.area / 1e6, 4), fmt(c.kgPc, 3), fmt(c.kgTot, 2)];
    });
    const foot = [['', 'Summe', rows.length + ' Positionen', t.pcs, '', t.holes, t.slots, '', fmt(t.areaTot / 1e6, 3), '', fmt(t.kg, 2)]];
    const right = { halign: 'right' };
    autoTable(doc, {
      startY: ty + 10, head, body, foot, theme: 'grid', showFoot: 'lastPage',
      margin: { left: M, right: M, bottom: 14 },
      styles: { fontSize: 8, cellPadding: 1.5, valign: 'middle', lineColor: [200, 200, 200], lineWidth: 0.1 },
      headStyles: { fillColor: blue, textColor: 255, fontSize: 7.5, valign: 'middle' },
      footStyles: { fillColor: [235, 240, 246], textColor: 0, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 26, minCellHeight: 17 }, 1: { cellWidth: 18 }, 2: { cellWidth: 70, fontSize: 7 },
        3: right, 4: right, 5: right, 6: right, 7: right, 8: right, 9: right, 10: { halign: 'right', fontStyle: 'bold' }
      },
      rowPageBreak: 'avoid',
      didParseCell: (d) => { if (d.column.index >= 3) d.cell.styles.halign = 'right'; },
      didDrawCell: (d) => {
        if (d.section === 'body' && d.column.index === 0) {
          const r = rows[d.row.index];
          drawThumbPdf(doc, r && r.res, d.cell.x + 1.5, d.cell.y + 1.5, d.cell.width - 3, d.cell.height - 3);
        }
      }
    });

    let y = doc.lastAutoTable.finalY + 8;
    if (y > doc.internal.pageSize.getHeight() - 70) { doc.addPage(); y = 16; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Zusammenfassung nach Materialstärke', M, y);
    autoTable(doc, {
      startY: y + 2, theme: 'striped', margin: { left: M, right: W / 2 + 4 }, tableWidth: W / 2 - M - 4,
      styles: { fontSize: 8.5, cellPadding: 1.5 }, headStyles: { fillColor: blue, halign: 'right' },
      footStyles: { fillColor: [235, 240, 246], textColor: 0, fontStyle: 'bold' },
      columnStyles: { 0: { halign: 'right', fontStyle: 'bold' }, 1: right, 2: right, 3: right, 4: right, 5: { halign: 'right', fontStyle: 'bold' } },
      head: [['Stärke', 'Pos.', 'Stück', 'Fläche m²', 'Gewicht kg', 'inkl. Verschn. kg']],
      body: t.byThk.map(g => [fmt(g.thk, g.thk % 1 ? 2 : 0) + ' mm', g.pos, g.pcs, fmt(g.area / 1e6, 3), fmt(g.kg, 2), fmt(g.gross, 2)]),
      didParseCell: (d) => { d.cell.styles.halign = 'right'; },
      foot: [['Summe', t.byThk.reduce((a, g) => a + g.pos, 0), t.pcs, fmt(t.areaTot / 1e6, 3), fmt(t.kg, 2), fmt(t.gross, 2)]]
    });

    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Gesamt', W / 2 + 8, y);
    const sumRows = [
      ['Gesamtgewicht Bauteile (' + t.pcs + ' Stk.)', fmt(t.kg, 2) + ' kg'],
      ['Verschnitt ' + fmt(t.scrapP, t.scrapP % 1 ? 1 : 0) + ' %', '+ ' + fmt(t.scrapKg, 2) + ' kg'],
      ['Gesamtgewicht inkl. Verschnitt', fmt(t.gross, 2) + ' kg'],
      ['Material: ' + fmt(t.gross, 2) + ' kg × ' + fmt(t.price, 2) + ' €/' + unit, fmt(t.matCost, 2) + ' €'],
      ['Bohrungen: ' + t.holes + ' Stk × ' + fmt(t.pHole, 2) + ' €', fmt(t.holeCost, 2) + ' €'],
      ['Langlöcher: ' + t.slots + ' Stk × ' + fmt(t.pSlot, 2) + ' €', fmt(t.slotCost, 2) + ' €'],
      ['Kantungen: ' + t.bends + ' Stk × ' + fmt(t.pBend, 2) + ' €', fmt(t.bendCost, 2) + ' €'],
      ['Datenaufbereitung', fmt(t.prepCost, 2) + ' €'],
      ['Gesamtpreis', fmt(t.cost, 2) + ' €']
    ];
    autoTable(doc, {
      startY: y + 2, theme: 'plain', margin: { left: W / 2 + 8, right: M },
      styles: { fontSize: 9, cellPadding: 1.6 },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      body: sumRows,
      didParseCell: (d) => {
        const last = sumRows.length - 1;
        if (d.row.index === 2 || d.row.index === last) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 11; }
        if (d.row.index === last) { d.cell.styles.fillColor = [235, 240, 246]; d.cell.styles.textColor = blue; }
      }
    });
    if (t.bad) {
      doc.setFontSize(8); doc.setTextColor(185, 28, 28);
      doc.text(`Achtung: ${t.bad} Position(en) ohne gültige Fläche/Stärke sind nicht im Gewicht enthalten.`, M, doc.lastAutoTable.finalY + 6);
      doc.setTextColor(0);
    }

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
      const H = doc.internal.pageSize.getHeight();
      doc.text((order ? order + '  ·  ' : '') + (adr[0] || 'DXF Gewichtsrechner'), M, H - 7);
      doc.text(`Seite ${i} von ${pages}`, W - M, H - 7, { align: 'right' });
      doc.setTextColor(0);
    }
    return doc;
  }

  el.pdf.addEventListener('click', async () => {
    if (!rows.length) return;
    if (!window.jspdf) { alert('PDF-Funktion konnte nicht geladen werden.'); return; }
    const order = el.order.value.trim().replace(/[\\/:*?"<>|]+/g, '_');
    const name = (order || 'DXF_Gewicht') + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
    let doc;
    try { doc = buildPdf(); } catch (e) { alert('PDF-Fehler: ' + (e.message || e)); return; }
    // iPhone/iPad: über das Teilen-Menü speichern ("In Dateien sichern"), sonst normaler Download
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && navigator.canShare) {
      const file = new File([doc.output('blob')], name, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
    }
    doc.save(name);
  });

  // ---------- Teilen-Ziel (Android: aus WhatsApp o. ä. an die App teilen) ----------
  async function loadShared() {
    if (!/[?&]share=1/.test(location.search) || !('caches' in window)) return;
    history.replaceState(null, '', location.pathname);
    try {
      const cache = await caches.open('share-inbox');
      const files = [];
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        const blob = await res.blob();
        files.push(new File([blob], decodeURIComponent(res.headers.get('x-name') || 'datei'), { type: blob.type }));
        await cache.delete(req);
      }
      if (files.length) addFiles(files);
      else setStatus('Keine geteilten Dateien empfangen.');
    } catch (e) { setStatus('Geteilte Dateien konnten nicht gelesen werden.'); }
  }

  // ---------- Start ----------
  loadSettings();
  render();
  loadShared();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
