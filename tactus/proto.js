// Tactus V2 site prototype (Phase 4): the hero is a small version of the app.
// It performs each step by itself first (a ghost cursor taps the real controls),
// then hands the controls to the visitor. Sound starts on the visitor's first tap.
// Die-face positions, accent defaults and the click synth follow the current site's
// "Try it" demo, which was ported from the app.
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const DIE = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
    7: [0, 2, 3, 4, 5, 6, 8], 8: [0, 1, 2, 3, 5, 6, 7, 8],
    9: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  };
  const FRAC = [0.225, 0.5, 0.775];
  const NEXT_ACCENT = { strong: 'normal', normal: 'soft', soft: 'silent', silent: 'strong' };
  const KEY_ROWS = [[4, [2, 3, 4, 5, 6, 7]], [8, [3, 5, 6, 7, 9, 12]], [16, [3, 4, 5, 6, 7, 9]]];
  const MAX_BARS = 12;
  const DEMO_METERS = [[4, 4], [5, 8], [5, 16]];
  const MAX_NODES = 5;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COACH = {
    1: { watch: 'Watch: type the meters, one tap each.', turn: 'Your turn. Tap some meters, then Go.', next: 'Next: split a beat' },
    2: { watch: 'Watch: tap a beat.', turn: 'Your turn. Tap any beat.', next: 'Next: tuplets' },
    3: { watch: 'Watch: tap a beat.', turn: 'Your turn. Pick a beat and spread it across two or more.', next: 'Next: tempo' },
    4: { watch: 'Watch: drag the end up to speed up.', turn: 'Your turn. Drag a dot, tap to add one, bend the line with Curve.', next: 'Get the app' },
  };

  const S = {
    bars: [], queue: [], tempo: 120,
    nodes: [],           // tempo shape: { f: 0..1 through the passage, bpm }, sorted by f
    headF: null, selNode: null,
    demo: true,          // bars were put there by the page, so the visitor's first Go replaces them
    step: 1, sel: null, playing: false, activeBar: -1,
    seen: {}, did: {},
  };

  const stage = $('#stage'), barsEl = $('#bars'), coachEl = $('#coach'), nextBtn = $('#next');
  const playBtn = $('#play'), tVal = $('#tVal'), soundBtn = $('#sound');
  const panelKeys = $('#panelKeys'), panelEdit = $('#panelEdit');
  const queueEl = $('#queue'), goBtn = $('#go'), keysEl = $('#keys');
  const editEmpty = $('#editEmpty'), editBody = $('#editBody'), editTitle = $('#editTitle');
  const editCluster = $('#editCluster'), notesEl = $('#notes'), acrossWrap = $('#acrossWrap'), acrossEl = $('#across');
  const panelTempo = $('#panelTempo'), graph = $('#graph'), examples = $('#examples');
  const curveIn = $('#curve'), curveVal = $('#curveVal'), delDot = $('#delDot'), soundLabel = $('#soundLabel');
  const ghost = $('#ghost');
  const logoMark = $('.logo-mark');
  let soundWas = false;

  // ── Model ───────────────────────────────────────────────────
  // bar.beats[i] is a number (notes in a plain beat) or { pulseCount, spannedBeats } (a tuplet).
  const makeBar = ([num, den]) => ({ num, den, beats: new Array(num).fill(1), overrides: new Array(num).fill(null) });
  const isTup = (slot) => typeof slot === 'object';
  const pulsesOf = (slot) => (isTup(slot) ? slot.pulseCount : slot);
  const spanOf = (slot) => (isTup(slot) ? slot.spannedBeats : 1);

  function computedAccent(bar, bi, si) {
    if (bar.den >= 16) return bi === 0 && si === 0 ? 'strong' : 'soft';
    if (si > 0) return 'soft';
    return bi === 0 ? 'strong' : 'normal';
  }
  function accentFor(bar, bi, si) {
    const ov = bar.overrides[bi];
    return ov && ov[si] != null ? ov[si] : computedAccent(bar, bi, si);
  }
  function cycleAccent(bar, bi, si) {
    if (!bar.overrides[bi]) bar.overrides[bi] = [];
    bar.overrides[bi][si] = NEXT_ACCENT[accentFor(bar, bi, si)];
  }
  function setNotes(bar, bi, n) {
    const slot = bar.beats[bi];
    if (isTup(slot)) slot.pulseCount = n; else bar.beats[bi] = n;
    if (bar.overrides[bi]) bar.overrides[bi].length = Math.min(bar.overrides[bi].length, n);
  }
  function maxSpan(bar, bi) {
    let n = spanOf(bar.beats[bi]);
    for (let i = bi + 1; i < bar.beats.length && !isTup(bar.beats[i]); i++) n++;
    return Math.min(n, 4);
  }
  function setSpan(bar, bi, span) {
    const slot = bar.beats[bi];
    const cur = spanOf(slot);
    if (span === cur) return;
    let pulses = pulsesOf(slot);
    if (isTup(slot)) {          // back to plain beats first
      bar.beats.splice(bi, 1, ...new Array(cur).fill(1));
      bar.overrides.splice(bi, 1, ...new Array(cur).fill(null));
    }
    if (span > 1) {
      if (pulses < 2 || pulses === span) pulses = span === 3 ? 2 : 3;
      bar.beats.splice(bi, span, { pulseCount: pulses, spannedBeats: span });
      bar.overrides.splice(bi, span, null);
    } else {
      bar.beats[bi] = pulses;
    }
  }
  const beatNumber = (bar, bi) => 1 + bar.beats.slice(0, bi).reduce((a, s) => a + spanOf(s), 0);

  // ── Rendering ───────────────────────────────────────────────
  function clusterEl(bar, bi, big) {
    const n = pulsesOf(bar.beats[bi]);
    const c = el(big ? 'div' : 'button', 'cluster' + (big ? ' big' : ''));
    if (!big) c.type = 'button';
    const filled = DIE[n] || DIE[1];
    for (let i = 0; i < 9; i++) {
      const si = filled.indexOf(i);
      const live = big && si !== -1;      // in the editor card each dot is a real button
      const d = el(live ? 'button' : 'span', si === -1 ? 'd empty' : 'd ' + accentFor(bar, bi, si));
      if (live) { d.type = 'button'; d.setAttribute('aria-label', `Note ${si + 1}: ${accentFor(bar, bi, si)}. Press to change.`); }
      d.style.left = FRAC[i % 3] * 100 + '%';
      d.style.top = FRAC[Math.floor(i / 3)] * 100 + '%';
      if (si !== -1) d.dataset.sub = si;
      c.appendChild(d);
    }
    return c;
  }

  const edgeOf = (b) => b.classList.toggle('more', b.scrollLeft + b.clientWidth < b.scrollWidth - 2);
  const updateEdges = () => barsEl.querySelectorAll('.bar-beats').forEach(edgeOf);

  function renderBars(animateFrom = -1) {
    const ae = document.activeElement;
    const keep = ae && ae.classList && ae.classList.contains('cluster') && barsEl.contains(ae) ? [ae.dataset.bar, ae.dataset.beat] : null;
    const top = barsEl.scrollTop;
    const lefts = [...barsEl.querySelectorAll('.bar-beats')].map((b) => b.scrollLeft);
    barsEl.textContent = '';
    if (!S.bars.length) {
      barsEl.appendChild(el('p', 'bars-empty', 'No bars yet. Tap a meter, then Go.'));
      return;
    }
    S.bars.forEach((bar, i) => {
      const row = el('div', 'bar' + (i === S.activeBar ? ' is-active' : ''));
      row.dataset.i = i;
      if (animateFrom >= 0 && i >= animateFrom) {
        row.classList.add('in');
        row.style.animationDelay = (i - animateFrom) * 50 + 'ms';
      }
      row.appendChild(el('span', 'bar-n', String(i + 1)));
      const m = el('span', 'bar-m');
      m.append(el('span', '', bar.num), el('span', '', bar.den));
      row.appendChild(m);
      const beats = el('div', 'bar-beats');
      bar.beats.forEach((slot, bi) => {
        const c = clusterEl(bar, bi, false);
        c.dataset.bar = i; c.dataset.beat = bi;
        c.setAttribute('aria-label', `Bar ${i + 1}, beat ${beatNumber(bar, bi)}: ${pulsesOf(slot)} notes`);
        if (S.sel && S.sel.bar === i && S.sel.beat === bi) c.classList.add('is-sel');
        if (isTup(slot)) {
          const w = el('div', 'tup');
          w.style.setProperty('--span', slot.spannedBeats);
          w.append(el('span', 'tup-label', slot.pulseCount + ':' + slot.spannedBeats), c);
          beats.appendChild(w);
        } else beats.appendChild(c);
      });
      row.appendChild(beats);
      barsEl.appendChild(row);
    });
    barsEl.scrollTop = top;
    paintFocus();
    // On phones a long bar scrolls sideways: keep its place, and fade the edge that hides beats.
    barsEl.querySelectorAll('.bar-beats').forEach((b, i) => {
      if (animateFrom < 0 && lefts[i]) b.scrollLeft = lefts[i];
      b.addEventListener('scroll', () => edgeOf(b), { passive: true });
    });
    updateEdges();
    if (keep) { const c = clusterAt(keep[0], keep[1]); if (c) c.focus({ preventScroll: true }); }
    if (S.step === 4) renderGraph();
  }

  const clusterAt = (bar, beat) => barsEl.querySelector(`.cluster[data-bar="${bar}"][data-beat="${beat}"]`);

  function renderQueue() {
    queueEl.textContent = '';
    if (!S.queue.length) queueEl.appendChild(el('span', 'ph', 'Tap a meter'));
    S.queue.forEach(([n, d]) => queueEl.appendChild(el('span', '', n + '/' + d)));
    queueEl.classList.toggle('is-long', S.queue.length > 4);
    goBtn.disabled = !S.queue.length;
  }

  function renderTempo() {
    tVal.textContent = '\u2669 = ' + S.tempo;
  }

  function renderEdit() {
    const sel = S.sel, bar = sel && S.bars[sel.bar];
    const ok = !!bar && bar.beats[sel.beat] != null;
    editEmpty.hidden = ok; editBody.hidden = !ok;
    if (!ok) return;
    const slot = bar.beats[sel.beat];
    editTitle.textContent = `Bar ${sel.bar + 1} · beat ${beatNumber(bar, sel.beat)}`;
    const ae = document.activeElement;
    const keepSub = ae && editCluster.contains(ae) && ae.dataset ? ae.dataset.sub : null;
    editCluster.textContent = '';
    editCluster.appendChild(clusterEl(bar, sel.beat, true));
    if (keepSub != null) { const d = editCluster.querySelector(`.d[data-sub="${keepSub}"]`); if (d) d.focus({ preventScroll: true }); }
    notesEl.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', +b.dataset.n === pulsesOf(slot)));
    acrossWrap.hidden = S.step < 3;
    acrossEl.textContent = '';
    const max = maxSpan(bar, sel.beat);
    for (let i = 1; i <= max; i++) {
      const b = el('button', i === spanOf(slot) ? 'is-on' : '', i);
      b.type = 'button'; b.dataset.span = i;
      acrossEl.appendChild(b);
    }
  }

  let coachText = '';
  const paintCoach = () => { coachEl.textContent = coachText + (soundChosen ? '' : ' Tap anywhere for sound.'); };
  function setCoach(text, turn) {
    coachText = text; paintCoach();
    coachEl.classList.remove('turn');
    if (turn) { void coachEl.offsetWidth; coachEl.classList.add('turn'); }
  }
  function renderNext() {
    const show = !!S.did[S.step] && !ghosting;
    nextBtn.hidden = !show;
    if (show) nextBtn.textContent = COACH[S.step].next + ' →';
  }

  // ── Actions (used by both the visitor and the ghost) ────────
  function typeMeter(m) {
    const have = S.demo ? 0 : S.bars.length;
    if (have + S.queue.length >= MAX_BARS) {
      setCoach(`This page stops at ${MAX_BARS} bars.`, true);
      return;
    }
    S.queue.push(m);
    renderQueue();
  }
  function go(byPage) {
    if (!S.queue.length) return;
    if (S.demo || byPage) { S.bars = []; S.activeBar = -1; }
    const from = S.bars.length;
    S.bars.push(...S.queue.map(makeBar));
    S.queue = []; S.demo = !!byPage; S.sel = null;
    renderQueue(); renderBars(from); renderTempo(); renderEdit();
    play(from);
  }
  function loadPassage(p) {
    S.bars = p.bars; S.tempo = p.tempo; S.nodes = []; S.selNode = null;
    S.queue = []; S.demo = true; S.sel = null; S.activeBar = -1;
    renderQueue(); renderBars(0); renderTempo(); renderEdit();
    focusNow(0);
  }
  function select(bar, beat) {
    S.sel = { bar, beat };
    renderBars(); renderEdit();
  }
  function applyNotes(n) {
    const { bar, beat } = S.sel;
    setNotes(S.bars[bar], beat, n);
    renderBars(); renderEdit();
    const c = clusterAt(bar, beat);
    if (c) c.classList.add('pop');
  }
  function applySpan(span) {
    const { bar, beat } = S.sel;
    setSpan(S.bars[bar], beat, span);
    renderBars(); renderEdit();
    const c = clusterAt(bar, beat);
    if (c) c.classList.add('pop');
  }
  function userDid(step) {
    S.demo = false;
    if (step === S.step) { S.did[step] = true; renderNext(); }
  }

  const PRESETS = {
    quint() {
      const q = () => { const b = makeBar([4, 4]); b.beats = [5, 5, 5, 5]; return b; };
      return { tempo: 60, bars: [makeBar([4, 4]), q(), makeBar([4, 4]), q()] };
    },
    seven() {
      const acc = (m, pattern) => { const b = makeBar(m); b.overrides = pattern.split('').map((ch) => [{ S: 'strong', n: 'normal', s: 'soft' }[ch]]); return b; };
      const seven = () => acc([7, 8], 'Ssnsnss');
      const five = () => acc([5, 16], 'Ssnss');
      return { tempo: 120, bars: [seven(), seven(), five(), five(), seven(), five()] };
    },
  };
  const demoPassage = () => ({ tempo: 120, bars: DEMO_METERS.map(makeBar) });

  // ── Sound ───────────────────────────────────────────────────
  // Same click as the app's default sound: a sine per accent with an exponential decay.
  const CLICK = {
    strong: { freq: 4200, db: 0, ms: 45 },
    normal: { freq: 2800, db: -4, ms: 35 },
    soft: { freq: 1600, db: -9, ms: 28 },
  };
  let ctx = null, master = null, soundOn = false, soundChosen = false;
  const buffers = {};

  function clickBuffer(accent) {
    if (buffers[accent]) return buffers[accent];
    const p = CLICK[accent], sr = ctx.sampleRate, len = Math.ceil((p.ms / 1000) * sr);
    const buf = ctx.createBuffer(1, len, sr), data = buf.getChannelData(0);
    const gain = Math.pow(10, p.db / 20), w = (2 * Math.PI * p.freq) / sr, k = -6.908 / len;
    for (let i = 0; i < len; i++) data[i] = gain * Math.exp(k * i) * Math.sin(w * i);
    return (buffers[accent] = buf);
  }
  function soundEnable() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!ctx) { ctx = new Ctx(); master = ctx.createGain(); master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    // iPhone's silent switch mutes web audio unless the page asks for a playback session.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
    unmute(true);
    master.gain.value = 1; soundOn = true; renderSound();
  }
  // Older iPhones (and pages inside a frame) ignore audioSession. A silent looping <audio>
  // started from the tap moves the page to the "playback" channel, which the silent switch doesn't mute.
  let silentLoop = null;
  function unmute(on) {
    try {
      if (!silentLoop) {
        if (!on) return;
        const sr = 8000, n = sr / 2, b = new ArrayBuffer(44 + n * 2), d = new DataView(b);
        const w = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true);
        d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true);
        d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 2, true);
        silentLoop = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
        silentLoop.loop = true; silentLoop.setAttribute('playsinline', '');
      }
      if (on) silentLoop.play().catch(() => {}); else silentLoop.pause();
    } catch (e) { /* not supported */ }
  }
  // iOS suspends or "interrupts" the context (lock screen, call, tab switch). Wake it on any gesture.
  function wake() {
    if (!ctx || !soundOn || ctx.state === 'running' || ctx.state === 'closed') return;
    try { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* retry on the next gesture */ }
  }
  function soundMute() {
    soundOn = false;
    unmute(false);
    if (master) master.gain.value = 0;
    renderSound();
  }
  function renderSound() {
    soundBtn.classList.toggle('is-on', soundOn);
    soundLabel.textContent = soundOn ? 'Sound on' : 'Sound off';
    paintCoach();
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    if (soundOn && !soundWas) retrigger(soundBtn, 'ping');
    soundWas = soundOn;
  }
  function clickAt(perfTime, accent) {
    if (!soundOn || !ctx || ctx.state !== 'running' || accent === 'silent') return;
    const src = ctx.createBufferSource();
    src.buffer = clickBuffer(accent);
    src.connect(master);
    src.start(ctx.currentTime + Math.max(0, (perfTime - performance.now()) / 1000));
  }

  // ── Playback ────────────────────────────────────────────────
  // Loops the passage. Each bar is read from the model just before it sounds, so edits
  // made during playback are heard on the next pass. Visuals run on performance.now();
  // each click is handed to the audio clock about 70ms early, with its exact time.
  let playTok = 0, timers = [], followScroll = true;
  const later = (at, fn) => timers.push(setTimeout(fn, Math.max(0, at - performance.now())));

  const totalBeats = () => Math.max(1, S.bars.reduce((a, b) => a + b.num, 0));
  function fracAt(barIdx, bi) {
    let pos = 0;
    for (let i = 0; i < barIdx; i++) pos += S.bars[i].num;
    return (pos + beatNumber(S.bars[barIdx], bi) - 1) / totalBeats();
  }
  // Same bias as the app's segment curve: 0 is a straight line, the ends are ±1.
  const bend = (u, c) => (c > 0 ? Math.pow(u, 1 - c * 0.85) : c < 0 ? Math.pow(u, 1 - c * 0.85) : u);
  // Lines between the dots, each bent by its dot's curve, from the starting tempo; flat after the last dot.
  function bpmAtF(f) {
    let pf = 0, pb = S.tempo;
    for (const n of S.nodes) {
      if (f <= n.f) return pb + (n.bpm - pb) * bend((f - pf) / (n.f - pf || 1), n.curve);
      pf = n.f; pb = n.bpm;
    }
    return pb;
  }
  // Never below the graph's floor or above the app's Tempo Shape ceiling (the app clamps 20-300), so a beat can't have zero or negative length.
  const BPM_MIN = 30, BPM_MAX = 300;
  const tempoAt = (barIdx, bi) => {
    const v = bpmAtF(fracAt(barIdx, bi));
    return Number.isFinite(v) ? Math.max(BPM_MIN, Math.min(BPM_MAX, v)) : 120;
  };

  const FOCUS_LEAD = 300;
  function play(from = 0) {
    stop();
    if (!S.bars.length) return;
    S.playing = true; stage.classList.add('is-playing'); playBtn.setAttribute('aria-label', 'Stop');
    wake();
    const tok = ++playTok;
    let idx = from, nextAt = performance.now() + 160;
    S.playFrom = from; setActive(from, 300);
    const scheduleBar = () => {
      if (tok !== playTok) return;
      if (!S.bars.length) { stop(); return; }
      if (idx >= S.bars.length) idx = 0;
      const barIdx = idx, bar = S.bars[barIdx];
      let t = nextAt;
      const barStart = t;
      bar.beats.forEach((slot, bi) => {
        const dur = Math.max(10, (60000 / tempoAt(barIdx, bi)) * (4 / bar.den) * spanOf(slot));
        const n = pulsesOf(slot);
        const f0 = fracAt(barIdx, bi), f1 = f0 + spanOf(slot) / totalBeats(), bt = t;
        later(bt, () => { if (tok === playTok) { beatTick(f0, f1, dur); beatOn(); } });
        for (let s = 0; s < n; s++) {
          const at = t + (s * dur) / n;
          later(at - 70, () => { if (tok === playTok) clickAt(at, accentFor(bar, bi, s)); });
          later(at, () => { if (tok === playTok) pulse(barIdx, bi, s); });
        }
        t += dur;
      });
      nextAt = t; idx++;
      // As in the app (scheduleNextBarFocus, barFocusLeadTime 0.30): 300ms before the next
      // downbeat the list starts sliding the next bar to the focal line and that bar takes focus.
      const nextIdx = idx >= S.bars.length ? 0 : idx;
      later(Math.max(barStart, t - FOCUS_LEAD), () => { if (tok === playTok) setActive(nextIdx, FOCUS_LEAD); });
      if (timers.length > 600) timers.splice(0, timers.length - 300);   // old ids have fired
      later(t - 120, scheduleBar);
    };
    scheduleBar();
  }
  function stop() {
    playTok++;
    timers.forEach(clearTimeout); timers = [];
    const was = S.playing;
    S.playing = false; S.activeBar = -1; S.headF = null; headBeat = null;
    hideHead(); renderTempo();
    stage.classList.remove('is-playing'); playBtn.setAttribute('aria-label', 'Play');
    // As in the app: on stop the list glides back to the bar playback started from (250ms).
    if (was) { paintFocus(S.playFrom || 0); scrollFocus(S.playFrom || 0, 250); }
    barsEl.querySelectorAll('.bar-beats').forEach((b) => slideLeft(b, 0));
  }
  function retrigger(node, cls) {
    if (!node) return;
    node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls);
  }
  // The logo's teal dot keeps time while a passage plays. The stage itself only does what the app does.
  function beatOn() { retrigger(logoMark, 'beat'); }
  // ── The focal list, as in the app's editor ──────────────────
  // One bar sits on the focal line and is the lit one; its neighbours fade with distance
  // (Tactus.opacity(dist:)). The list's scroll position is the app's focalBarOffset: index x row
  // height. Stopped, the bar on the line is whichever you scrolled to. Playing, the list is driven.
  const bez = (x1, y1, x2, y2) => (x) => {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d) < 1e-6) break;
      t -= (((ax * t + bx) * t + cx) * t - x) / d;
    }
    return ((ay * t + by) * t + cy) * t;
  };
  const easeOut = bez(0, 0, 0.58, 1), easeInOut = bez(0.42, 0, 0.58, 1);   // SwiftUI's curves
  const rowH = () => { const r = barsEl.querySelector('.bar'); return r ? r.getBoundingClientRect().height : 1; };
  let focusIdx = 0, focusTok = 0;
  function paintFocus(i = focusIdx) {
    focusIdx = Math.max(0, Math.min(S.bars.length - 1, i));
    barsEl.querySelectorAll('.bar').forEach((r) => {
      const d = Math.min(4, Math.abs(+r.dataset.i - focusIdx));
      r.dataset.d = d; r.classList.toggle('is-active', d === 0);
    });
  }
  function scrollFocus(i, ms) {
    const tok = ++focusTok, from = barsEl.scrollTop, to = i * rowH();
    if (!ms || reduced || Math.abs(to - from) < 1) { barsEl.classList.remove('driven'); barsEl.scrollTop = to; return; }
    barsEl.classList.add('driven');                 // snapping off while the list is driven
    const t0 = performance.now();
    const step = (now) => {
      if (tok !== focusTok) return;
      const p = Math.min(1, (now - t0) / ms);
      barsEl.scrollTop = from + (to - from) * easeOut(p);
      if (p < 1) requestAnimationFrame(step); else barsEl.classList.remove('driven');
    };
    requestAnimationFrame(step);
  }
  function focusNow(i) { paintFocus(i); scrollFocus(i, 0); }
  function setActive(i, ms) {
    S.activeBar = i;
    paintFocus(i); scrollFocus(i, ms);
  }
  barsEl.addEventListener('scroll', () => {
    if (S.playing || barsEl.classList.contains('driven')) return;
    const i = Math.round(barsEl.scrollTop / rowH());
    if (i !== focusIdx) paintFocus(i);
  }, { passive: true });
  // A bar too long for its row: the app centres the sounding beat over 120ms (ease in-out).
  function slideLeft(row, to) {
    to = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, to));
    const from = row.scrollLeft, tok = (row._tok = (row._tok || 0) + 1);
    if (Math.abs(to - from) < 1) return;
    if (reduced) { row.scrollLeft = to; return; }
    const t0 = performance.now();
    const step = (now) => {
      if (tok !== row._tok) return;
      const p = Math.min(1, (now - t0) / 120);
      row.scrollLeft = from + (to - from) * easeInOut(p);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function flash(cluster, bar, bi, si) {
    if (!cluster) return;
    const n = pulsesOf(bar.beats[bi]);
    const dot = cluster.children[(DIE[n] || DIE[1])[si]];
    if (!dot) return;
    dot.classList.remove('hit'); void dot.offsetWidth; dot.classList.add('hit');
  }
  function pulse(barIdx, bi, si) {
    const bar = S.bars[barIdx];
    if (!bar || bar.beats[bi] == null) return;
    const c = clusterAt(barIdx, bi);
    flash(c, bar, bi, si);
    const row = si === 0 && c && c.closest('.bar-beats');
    if (row) {
      // Rows that are no longer sounding go back to their first beat, as in the app.
      if (bi === 0) barsEl.querySelectorAll('.bar-beats').forEach((b) => { if (b !== row) slideLeft(b, 0); });
      if (row.scrollWidth > row.clientWidth) {
        const box = c.closest('.tup') || c;
        slideLeft(row, box.offsetLeft - row.offsetLeft + box.offsetWidth / 2 - row.clientWidth / 2);
      }
    }
    if (S.sel && S.sel.bar === barIdx && S.sel.beat === bi) flash(editCluster.firstChild, bar, bi, si);
  }

  // ── Tempo graph ─────────────────────────────────────────────
  // A small version of the app's Tempo Shape sheet: x is beats through the passage,
  // y is tempo around the starting tempo. Dots snap to beats and move freely up and down.
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const G = { w: 0, h: 132, l: 12, r: 16, t: 18, b: 10, lo: 20, hi: 220, drag: null };
  let headLine = null, headDot = null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const xFor = (f) => G.l + f * (G.w - G.l - G.r);
  const yFor = (bpm) => G.t + ((G.hi - bpm) / (G.hi - G.lo)) * (G.h - G.t - G.b);
  const bpmMin = () => Math.max(BPM_MIN, G.lo + 8), bpmMax = () => Math.min(BPM_MAX, G.hi - 8);

  function renderGraph() {
    const w = graph.clientWidth;
    if (!w) return;
    G.w = w; G.lo = S.tempo - 100; G.hi = S.tempo + 100;
    graph.setAttribute('viewBox', `0 0 ${w} ${G.h}`);
    const tot = totalBeats();
    graph.setAttribute('aria-label', `Tempo graph. Starts at ${S.tempo} bpm. ` + (S.nodes.length
      ? S.nodes.map((n, i) => `Dot ${i + 1}${n === S.selNode ? ' (selected)' : ''}: beat ${Math.round(n.f * tot)}, ${Math.round(n.bpm)} bpm.`).join(' ')
      : 'No dots yet. Press Enter to add one.') + ' Arrow keys move the selected dot, Delete removes it. Slower and Faster change the starting tempo.');
    graph.textContent = '';
    const total = totalBeats();
    let pos = 0;
    S.bars.forEach((bar) => {
      for (let k = 0; k < bar.num; k++) {
        const x = xFor((pos + k) / total);
        graph.appendChild(svgEl('line', { class: k ? 'g-beat' : 'g-bar', x1: x, x2: x, y1: 0, y2: G.h }));
      }
      pos += bar.num;
    });
    const yr = yFor(S.tempo), x0 = xFor(0), x1 = xFor(1);
    graph.appendChild(svgEl('line', { class: 'g-ref', x1: 0, x2: w, y1: yr, y2: yr }));
    const pts = [[x0, yr]];
    let pf = 0, pb = S.tempo;
    S.nodes.forEach((n) => {
      if (n.curve) for (let k = 1; k < 24; k++) pts.push([xFor(pf + ((n.f - pf) * k) / 24), yFor(pb + (n.bpm - pb) * bend(k / 24, n.curve))]);
      pts.push([xFor(n.f), yFor(n.bpm)]);
      pf = n.f; pb = n.bpm;
    });
    const last = pts[pts.length - 1];
    if (last[0] < x1) pts.push([x1, last[1]]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    graph.appendChild(svgEl('path', { class: 'g-area', d: `${d} L ${x1} ${G.h} L ${x0} ${G.h} Z` }));
    graph.appendChild(svgEl('path', { class: 'g-line', d }));
    headLine = svgEl('line', { class: 'g-headline', x1: 0, x2: 0, y1: 0, y2: G.h });
    headDot = svgEl('circle', { class: 'g-headdot', cx: 0, cy: 0, r: 4 });
    graph.append(headLine, headDot);
    if (S.playing && S.headF != null) { placeHead(reduced ? S.headF : headNow()); if (!reduced && !headRaf) headRaf = requestAnimationFrame(headFrame); } else hideHead();
    graph.appendChild(svgEl('circle', { class: 'g-entry', cx: x0, cy: yr, r: 3 }));
    const entry = svgEl('text', { class: 'g-lab entry', x: x0 + 7, y: yr - 7 });
    entry.textContent = S.tempo;
    graph.appendChild(entry);
    S.nodes.forEach((n) => {
      const cx = xFor(n.f), cy = yFor(n.bpm);
      graph.appendChild(svgEl('circle', { class: 'g-node' + (n === G.drag ? ' is-drag' : n === S.selNode ? ' is-sel' : ''), cx, cy, r: 8 }));
      const lab = svgEl('text', { class: 'g-lab', x: cx, y: cy < 28 ? cy + 21 : cy - 13 });
      lab.textContent = Math.round(n.bpm);
      graph.appendChild(lab);
    });
    renderCurve();
  }
  function renderCurve() {
    const n = S.nodes.includes(S.selNode) ? S.selNode : null;
    curveIn.disabled = delDot.disabled = !n;
    const c = n ? n.curve : 0;
    curveIn.value = c;
    curveVal.textContent = c ? (c > 0 ? '+' : '\u2212') + Math.abs(c).toFixed(2) : '0';
  }
  function setCurve(v) {
    if (!S.nodes.includes(S.selNode)) return;
    S.selNode.curve = Math.abs(v) < 0.03 ? 0 : v;
    renderGraph();
  }
  function placeHead(f) {
    const x = xFor(f);
    headLine.style.visibility = headDot.style.visibility = 'visible';
    headLine.style.transform = `translateX(${x}px)`;
    headDot.style.transform = `translate(${x}px, ${yFor(bpmAtF(f))}px)`;
  }
  function hideHead() {
    if (headLine) headLine.style.visibility = headDot.style.visibility = 'hidden';
  }
  // The playhead, as in the app's Tempo Shape sheet (drawPlayhead): every frame it is placed from
  // the clock, and its height is read from the ramp as it is now, so it stays on the line while
  // the line is being dragged. Each beat re-anchors it so it never drifts from the clicks.
  let headBeat = null, headRaf = 0;
  function headNow() {
    if (!headBeat) return S.headF;
    const p = Math.max(0, Math.min(1, (performance.now() - headBeat.t0) / headBeat.dur));
    return headBeat.f0 + (headBeat.f1 - headBeat.f0) * p;
  }
  function headFrame() {
    headRaf = 0;
    if (!S.playing || S.step !== 4 || !headLine || !headBeat) return;
    placeHead(headNow());
    headRaf = requestAnimationFrame(headFrame);
  }
  function beatTick(f0, f1, dur) {
    S.headF = f0;
    headBeat = { f0, f1: Math.min(1, f1), dur, t0: performance.now() };
    if (S.nodes.length) tVal.textContent = '\u2669 = ' + Math.round(bpmAtF(f0));
    if (S.step !== 4 || !headLine) return;
    placeHead(f0);
    if (!reduced && !headRaf) headRaf = requestAnimationFrame(headFrame);
  }

  // Dot editing, in graph pixels (used by both the visitor and the ghost).
  const nodeNear = (x, y) => S.nodes.find((n) => Math.hypot(xFor(n.f) - x, yFor(n.bpm) - y) < 18) || null;
  function readXY(x, y) {
    const total = totalBeats();
    const beat = clamp(Math.round(((x - G.l) / (G.w - G.l - G.r)) * total), 1, total);
    const bpm = clamp(Math.round(G.hi - ((y - G.t) / (G.h - G.t - G.b)) * (G.hi - G.lo)), bpmMin(), bpmMax());
    return { beat, bpm };
  }
  function addNode(x, y) {
    const { beat, bpm } = readXY(x, y), total = totalBeats();
    const same = S.nodes.find((n) => Math.round(n.f * total) === beat);
    if (same) return same;
    if (S.nodes.length >= MAX_NODES) return null;
    const node = { f: beat / total, bpm, curve: 0 };
    S.nodes.push(node);
    S.nodes.sort((a, b) => a.f - b.f);
    return node;
  }
  function dragNode(node, x, y) {
    const { beat, bpm } = readXY(x, y);
    setNode(node, beat, bpm);
  }
  function setNode(node, beat, bpm) {
    const total = totalBeats();
    const i = S.nodes.indexOf(node);
    const lo = i > 0 ? Math.round(S.nodes[i - 1].f * total) + 1 : 1;
    const hi = i < S.nodes.length - 1 ? Math.round(S.nodes[i + 1].f * total) - 1 : total;
    node.f = clamp(beat, lo, Math.max(lo, hi)) / total;
    node.bpm = clamp(bpm, BPM_MIN, BPM_MAX);
    S.selNode = node;
    renderGraph();
  }

  // ── Steps and the ghost ─────────────────────────────────────
  let gTok = 0, ghosting = false;
  class Cancelled extends Error {}
  const wait = (ms, tok) => new Promise((res, rej) => setTimeout(() => (tok === gTok ? res() : rej(new Cancelled())), ms));

  async function tap(target, tok) {
    if (!target) return;
    const s = stage.getBoundingClientRect(), r = target.getBoundingClientRect();
    ghost.style.transform = `translate(${r.left - s.left + r.width / 2}px, ${r.top - s.top + r.height / 2}px)`;
    ghost.classList.add('on');
    await wait(760, tok);          // arrive, rest a moment, then press
    ghost.classList.add('tap'); target.classList.add('pressed');
    await wait(240, tok);
    ghost.classList.remove('tap'); target.classList.remove('pressed');
  }
  // Press at a, drag to b (graph pixels). Makes a dot if there is none under the press.
  async function ghostDrag(a, b, tok) {
    const s = stage.getBoundingClientRect(), g = graph.getBoundingClientRect();
    const put = (x, y) => { ghost.style.transform = `translate(${g.left - s.left + x}px, ${g.top - s.top + y}px)`; };
    put(a[0], a[1]); ghost.classList.add('on');
    await wait(620, tok);
    ghost.classList.add('tap');
    const node = nodeNear(a[0], a[1]) || addNode(a[0], a[1]);
    if (!node) return;
    G.drag = S.selNode = node; renderGraph();
    await wait(200, tok);
    ghost.style.transition = 'none';
    const t0 = performance.now(), D = 850;
    for (;;) {
      await wait(16, tok);
      const u = Math.min(1, (performance.now() - t0) / D), e = u * u * (3 - 2 * u);
      const x = a[0] + (b[0] - a[0]) * e, y = a[1] + (b[1] - a[1]) * e;
      put(x, y); dragNode(node, x, y);
      if (u >= 1) break;
    }
    ghost.style.transition = ''; ghost.classList.remove('tap');
    G.drag = null; renderGraph();
  }
  async function ghostSlide(input, to, tok) {
    const s = stage.getBoundingClientRect(), r = input.getBoundingClientRect();
    const min = +input.min, max = +input.max, from = +input.value;
    const put = (v) => { ghost.style.transform = `translate(${r.left - s.left + 10 + ((v - min) / (max - min)) * (r.width - 20)}px, ${r.top - s.top + r.height / 2}px)`; };
    put(from); ghost.classList.add('on');
    await wait(760, tok);
    ghost.classList.add('tap');
    await wait(240, tok);
    ghost.style.transition = 'none';
    const t0 = performance.now(), D = 1300;
    for (;;) {
      await wait(16, tok);
      const u = Math.min(1, (performance.now() - t0) / D), e = u * u * (3 - 2 * u), v = from + (to - from) * e;
      put(v); setCurve(v);
      if (u >= 1) break;
    }
    ghost.style.transition = ''; ghost.classList.remove('tap');
  }
  function ghostCleanup() {
    ghosting = false; followScroll = true;
    ghost.classList.remove('on', 'tap');
    ghost.style.transition = '';
    G.drag = null;
    stage.querySelectorAll('.pressed').forEach((n) => n.classList.remove('pressed'));
  }

  const GHOSTS = {
    async 1(tok) {
      S.bars = []; S.queue = []; S.sel = null; S.demo = true;
      renderBars(); renderQueue();
      await wait(700, tok);
      for (const m of DEMO_METERS) {
        await tap(keysEl.querySelector(`[data-num="${m[0]}"][data-den="${m[1]}"]`), tok);
        typeMeter(m);
      }
      setCoach('Go turns them into bars.');
      await wait(300, tok);
      await tap(goBtn, tok);
      go(true);
      ghost.classList.remove('on');
      await wait(3200, tok);
    },
    // Steps 2 and 3 edit in silence, then play, so there is one thing to watch at a time.
    async 2(tok) {
      stop(); focusNow(0);
      await wait(700, tok);
      const k = Math.min(1, S.bars[0].beats.length - 1);
      await tap(clusterAt(0, k), tok);
      select(0, k);
      setCoach('Choose how many notes it holds.');
      await wait(500, tok);
      await tap(notesEl.querySelector('[data-n="3"]'), tok);
      applyNotes(3);
      ghost.classList.remove('on');
      await wait(700, tok);
      play(0);
      await wait(3000, tok);
    },
    async 3(tok) {
      stop(); focusNow(0);
      await wait(700, tok);
      // The last plain beat with a plain beat after it, in the first bar that has one.
      let spot = null;
      S.bars.some((bar, b) => {
        bar.beats.forEach((slot, k) => { if (slot === 1 && k > 0 && maxSpan(bar, k) >= 2) spot = { b, k }; });
        return spot;
      });
      if (!spot) return;
      await tap(clusterAt(spot.b, spot.k), tok);
      select(spot.b, spot.k);
      setCoach('Spread it across two beats: three notes in the time of two.');
      await wait(500, tok);
      await tap(acrossEl.querySelector('[data-span="2"]'), tok);
      applySpan(2);
      ghost.classList.remove('on');
      await wait(700, tok);
      play(spot.b);
      await wait(3400, tok);
    },
    async 4(tok) {
      S.nodes = []; S.selNode = null; renderGraph();
      if (!S.playing) play(0);
      await wait(900, tok);
      await ghostDrag([xFor(1), yFor(S.tempo)], [xFor(1), yFor(S.tempo + 64)], tok);
      setCoach('Curve bends the line: hold back, then rush.');
      await wait(600, tok);
      await ghostSlide(curveIn, -0.8, tok);
      ghost.classList.remove('on');
      await wait(2600, tok);
    },
  };

  async function runGhost(n) {
    const tok = ++gTok;
    ghosting = true; followScroll = false; S.seen[n] = true;
    setCoach(COACH[n].watch); renderNext();
    try { await GHOSTS[n](tok); } catch (e) { if (!(e instanceof Cancelled)) throw e; }
    if (tok === gTok) { ghostCleanup(); handOver(n); }
  }
  function cancelGhost() {
    if (!ghosting) return;
    gTok++; ghostCleanup();
    // Cut short before the bars arrived: show the whole opening passage, never an empty list.
    if (!S.bars.length || (S.step === 1 && S.queue.length)) { stop(); loadPassage(demoPassage()); }
    handOver(S.step);
  }
  function handOver(n) {
    setCoach(COACH[n].turn, true);
    const panel = n === 1 ? panelKeys : n === 4 ? panelTempo : panelEdit;
    panel.classList.remove('yours'); void panel.offsetWidth; panel.classList.add('yours');
    renderNext();
  }

  // Back to the passage the page opened with, on the step you are on.
  function startOver() {
    stop();
    S.tempo = 120;
    loadPassage(demoPassage());
    setStep(S.step, true);
  }

  function setStep(n, quiet) {
    if (ghosting) { gTok++; ghostCleanup(); }
    S.step = n;
    stage.querySelectorAll('.step').forEach((b) => {
      const on = +b.dataset.step === n;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    panelKeys.hidden = n !== 1; panelEdit.hidden = n !== 2 && n !== 3; panelTempo.hidden = n !== 4;
    if (n > 1 && !S.bars.length) loadPassage(demoPassage());
    renderEdit();
    if (n === 4) {
      examples.hidden = false;          // examples wait until the last step, so each step has one way on
      if ((quiet || reduced || S.seen[4]) && !S.nodes.length) S.nodes = [S.selNode = { f: 1, bpm: S.tempo + 48, curve: 0 }];
      renderGraph();
    }
    pending = false;
    if (!quiet && !S.seen[n] && !reduced) {
      if (watchView && !stageInView) { pending = true; setCoach(COACH[n].watch); renderNext(); }   // starts when the demo scrolls into view
      else runGhost(n);
    } else { S.seen[n] = true; handOver(n); }
  }

  // The ghost only performs while the demo is on screen. Scrolled away mid-run, it puts the step
  // back to its opening state and plays again from the start on return.
  let stageInView = false, pending = false;
  const watchView = 'IntersectionObserver' in window && !reduced;
  function backToOpening() {
    const n = S.step;
    gTok++; ghostCleanup(); stop();
    if (n === 1) { S.bars = []; S.queue = []; S.sel = null; S.demo = true; S.tempo = 120; renderBars(); renderQueue(); renderTempo(); renderEdit(); }
    else { loadPassage(demoPassage()); if (n === 4) renderGraph(); }
    S.seen[n] = false; pending = true;
    setCoach(COACH[n].watch); renderNext();
  }
  if (watchView) {
    // Fine thresholds: a stage taller than the window never reaches a high ratio, but the share of the window it fills can still pass 0.9.
    new IntersectionObserver(([en]) => {
      const vh = en.rootBounds ? en.rootBounds.height : innerHeight;
      const seen = en.intersectionRect.height / Math.min(en.boundingClientRect.height, vh);
      if (seen >= 0.9 && !stageInView) { stageInView = true; if (pending) { pending = false; runGhost(S.step); } }
      else if (seen < 0.5 && stageInView) { stageInView = false; if (ghosting) backToOpening(); }
    }, { threshold: Array.from({ length: 51 }, (_, i) => i / 50) }).observe(stage);
  }

  // ── Wiring ──────────────────────────────────────────────────
  KEY_ROWS.forEach(([den, nums]) => {
    const row = el('div', 'key-row');
    row.appendChild(el('span', '', '/' + den));
    nums.forEach((num) => {
      const k = el('button', 'key');
      k.type = 'button'; k.dataset.num = num; k.dataset.den = den;
      k.setAttribute('aria-label', `${num}/${den}`);
      k.append(el('span', '', num), el('span', '', den));
      row.appendChild(k);
    });
    keysEl.appendChild(row);
  });
  for (let n = 1; n <= 9; n++) {
    const b = el('button', '', n);
    b.type = 'button'; b.dataset.n = n;
    notesEl.appendChild(b);
  }

  // The visitor's first tap in the demo turns sound on and ends any ghost run.
  // Only a tap ends it: a finger that lands on the stage to scroll the page must not. A click
  // never follows a scroll; the graph and the slider take drags, so they end it on contact.
  stage.addEventListener('click', (e) => { if (pending && !e.target.closest('.steps')) { pending = false; S.seen[S.step] = true; handOver(S.step); } }, true);
  stage.addEventListener('click', cancelGhost, true);
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.target.closest('#graph, input[type="range"]')) cancelGhost();
  }, true);
  stage.addEventListener('click', (e) => {
    if (!soundChosen && !e.target.closest('#sound')) { soundChosen = true; soundEnable(); }
  }, true);
  // A gesture that ends on the stage (a tap, a slider or graph drag, a key) also wakes a sleeping context.
  // The first touch may be the Curve slider, which sends no click, so pointerup turns sound on too.
  ['pointerdown', 'keydown'].forEach((t) => stage.addEventListener(t, wake, true));
  stage.addEventListener('pointerup', (e) => {
    if (!soundChosen && !e.target.closest('#sound')) { soundChosen = true; soundEnable(); }
    wake();
  }, true);
  stage.addEventListener('input', () => {
    if (!soundChosen) { soundChosen = true; soundEnable(); }
  }, true);
  soundBtn.addEventListener('click', () => {
    soundChosen = true;
    if (soundOn) soundMute(); else soundEnable();
  });

  keysEl.addEventListener('click', (e) => {
    const k = e.target.closest('.key');
    if (k) typeMeter([+k.dataset.num, +k.dataset.den]);
  });
  $('#back').addEventListener('click', () => { S.queue.pop(); renderQueue(); });
  goBtn.addEventListener('click', () => {
    if (!S.queue.length) return;
    go(false); userDid(1);
    setCoach('Add more bars, or go on to beats.', true);
  });
  $('.presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    if (b.dataset.preset === 'original') { startOver(); return; }
    loadPassage(PRESETS[b.dataset.preset]());
    play(0);
  });

  barsEl.addEventListener('click', (e) => {
    const c = e.target.closest('.cluster');
    if (!c) return;
    if (S.step === 4) return;
    if (S.step < 2) setStep(2, true);
    select(+c.dataset.bar, +c.dataset.beat);
  });
  notesEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !S.sel) return;
    applyNotes(+b.dataset.n); userDid(2);
  });
  acrossEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !S.sel) return;
    applySpan(+b.dataset.span); userDid(3);
  });
  editCluster.addEventListener('click', (e) => {
    const d = e.target.closest('.d');
    if (!d || d.dataset.sub == null || !S.sel) return;
    cycleAccent(S.bars[S.sel.bar], S.sel.beat, +d.dataset.sub);
    renderBars(); renderEdit(); userDid(2);
  });
  $('#addBars').addEventListener('click', () => setStep(1, true));

  playBtn.addEventListener('click', () => {
    if (S.playing) stop();
    else { if (!S.bars.length) loadPassage(demoPassage()); play(0); }
  });
  const nudge = (d) => {
    const t = clamp(S.tempo + d, 40, 240), by = t - S.tempo;
    S.tempo = t;
    S.nodes.forEach((n) => { n.bpm = clamp(n.bpm + by, BPM_MIN, BPM_MAX); });     // the whole shape moves with the starting tempo
    renderTempo();
    if (S.step === 4) renderGraph();
  };
  $('#tDown').addEventListener('click', () => nudge(-4));
  $('#tUp').addEventListener('click', () => nudge(4));

  stage.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => setStep(+b.dataset.step)));
  nextBtn.addEventListener('click', () => {
    if (S.step < 4) setStep(S.step + 1);
    else document.getElementById('get').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });

  // Graph: press empty space to add a dot and keep dragging it; press a dot to select or drag it.
  let gp = null;
  const gxy = (e) => { const r = graph.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // On a phone a drag that starts on empty graph is a page scroll (touch-action: pan-y), and a dot is
  // added only by a tap there. A press on an existing dot never scrolls: touchstart is cancelled for it.
  graph.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const r = graph.getBoundingClientRect();
    if (nodeNear(e.touches[0].clientX - r.left, e.touches[0].clientY - r.top)) e.preventDefault();
  }, { passive: false });
  graph.addEventListener('pointerdown', (e) => {
    const [x, y] = gxy(e);
    const hit = nodeNear(x, y);
    if (e.pointerType === 'touch' && !hit) { gp = { tap: true, x, y, t: performance.now(), moved: false }; return; }
    const node = hit || addNode(x, y);
    if (!node) { setCoach(`This page stops at ${MAX_NODES} dots.`, true); return; }
    gp = { node, isNew: !hit, x, y, moved: false };
    G.drag = S.selNode = node;
    graph.setPointerCapture(e.pointerId);
    renderGraph();
    e.preventDefault();
  });
  graph.addEventListener('pointermove', (e) => {
    if (!gp) return;
    const [x, y] = gxy(e);
    if (Math.hypot(x - gp.x, y - gp.y) > (gp.tap ? 8 : 5)) gp.moved = true;
    if (gp.moved && gp.node) dragNode(gp.node, x, y);
  });
  const gEnd = (e) => {
    if (!gp) return;
    const tap = gp.tap && !gp.moved && e.type === 'pointerup' && performance.now() - gp.t < 600;
    const at = [gp.x, gp.y];
    gp = null; G.drag = null;
    if (tap) {
      const node = addNode(at[0], at[1]);
      if (!node) { setCoach(`This page stops at ${MAX_NODES} dots.`, true); return; }
      S.selNode = node;
    }
    renderGraph(); userDid(4);
  };
  graph.addEventListener('pointerup', gEnd);
  graph.addEventListener('pointercancel', gEnd);
  // Keyboard: arrows move the selected dot (left/right by a beat, up/down by 4 bpm like Slower and
  // Faster; Shift for 1 bpm), Enter adds a dot, Delete removes it. Tab/Shift+Tab or [ ] pick a dot.
  graph.addEventListener('keydown', (e) => {
    const total = totalBeats(), n = S.selNode;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (n) return;
      const nd = addNode(xFor(1), yFor(S.tempo));
      if (nd) { S.selNode = nd; renderGraph(); userDid(4); } else setCoach(`This page stops at ${MAX_NODES} dots.`, true);
      return;
    }
    if (e.key === '[' || e.key === ']') {
      if (!S.nodes.length) return;
      const i = Math.max(0, S.nodes.indexOf(n)) + (e.key === ']' ? 1 : -1);
      S.selNode = S.nodes[(i + S.nodes.length) % S.nodes.length]; renderGraph(); return;
    }
    if (!n) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delDot.click(); return; }
    const step = e.shiftKey ? 1 : 4, beat = Math.round(n.f * total);
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!move) return;
    e.preventDefault();
    setNode(n, beat + move[0], n.bpm + move[1]); userDid(4);
  });
  curveIn.addEventListener('input', () => { setCurve(+curveIn.value); userDid(4); });
  delDot.addEventListener('click', () => {
    const i = S.nodes.indexOf(S.selNode);
    if (i < 0) return;
    S.nodes.splice(i, 1);
    S.selNode = S.nodes[Math.min(i, S.nodes.length - 1)] || null;
    renderGraph(); userDid(4);
  });
  $('#reset').addEventListener('click', startOver);
  const specList = $('.spec-list');
  if (specList && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => specList.classList.toggle('idle', !en.isIntersecting)).observe(specList);
  }
  // Sizes can change under us (window resize, phone rotation): re-measure the focal row, the edge fades and the graph.
  let relayout = 0;
  const layout = () => {
    relayout = 0;
    updateEdges();
    if (!S.playing && S.bars.length) scrollFocus(focusIdx, 0);
    if (S.step === 4) renderGraph();
  };
  const queueLayout = () => { if (!relayout) relayout = requestAnimationFrame(layout); };
  addEventListener('resize', queueLayout);
  addEventListener('orientationchange', queueLayout);

  // Hidden tab: stop the sound and put a running ghost back to its opening; it starts again on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (ghosting) backToOpening(); else stop(); return; }
    wake();
    if (pending && stageInView) { pending = false; runGhost(S.step); }
  });

  // ── App clips: play only while on screen; reduced motion keeps the poster ──
  const clips = document.querySelectorAll('video.clip');
  if (clips.length && !reduced && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((ens) => ens.forEach((en) => {
      const v = en.target;
      if (en.isIntersecting) { if (v.preload === 'none') v.preload = 'auto'; v.play().catch(() => {}); }
      else v.pause();
    }), { threshold: 0.35 });
    clips.forEach((v) => io.observe(v));
  }

  // ── Start ───────────────────────────────────────────────────
  renderQueue(); renderTempo(); renderSound();
  if (reduced) { loadPassage(demoPassage()); setStep(1, true); }
  else setStep(1);
})();
