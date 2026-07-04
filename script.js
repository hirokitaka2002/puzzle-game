(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const timeEl = document.getElementById("time");
  const comboEl = document.getElementById("combo");
  const finalScoreEl = document.getElementById("finalScore");
  const titleOverlay = document.getElementById("titleOverlay");
  const resultOverlay = document.getElementById("resultOverlay");
  const startButton = document.getElementById("startButton");
  const restartButton = document.getElementById("restartButton");
  const startFromTitle = document.getElementById("startFromTitle");
  const restartFromResult = document.getElementById("restartFromResult");
  const motionButton = document.getElementById("motionButton");
  const motionStatus = document.getElementById("motionStatus");
  const sensitivityButtons = [...document.querySelectorAll("[data-sensitivity]")];
  const muteButton = document.getElementById("muteButton");
  const volumeSlider = document.getElementById("volumeSlider");
  const timerStat = document.querySelector(".timer-stat");

  const W = 360;
  const H = 360;
  const PIECE_COUNT = 18;
  const RADIUS = 34;
  const PICK_RADIUS = RADIUS * 1.24;
  const LINK_DISTANCE = RADIUS * 3.7;
  const GRAVITY = 360;
  const TILT_MULTIPLIERS = { low: 0.62, medium: 1, high: 1.65 };
  const TYPES = [
    { name: "Piko", main: "#ff707e", shade: "#c83465", glow: "#ffd4d9", cheek: "#ffd0cc", feature: "ears" },
    { name: "Mofu", main: "#5bd7ff", shade: "#1479c9", glow: "#d9fbff", cheek: "#ffb8d4", feature: "horn" },
    { name: "Nico", main: "#ffd85c", shade: "#d99523", glow: "#fff7b4", cheek: "#ff9a73", feature: "cap" },
    { name: "Luma", main: "#82e676", shade: "#2c9d65", glow: "#e1ffd1", cheek: "#ffe1a8", feature: "sprout" },
    { name: "Bibi", main: "#b58cff", shade: "#6849c9", glow: "#efe0ff", cheek: "#ffb3f0", feature: "dots" }
  ];

  const state = {
    pieces: [],
    items: [],
    selected: [],
    pointer: { x: 0, y: 0, prevX: 0, prevY: 0, active: false },
    activeTouchId: null,
    lastTouchTime: -Infinity,
    tilt: {
      enabled: false,
      permissionGranted: false,
      sensitivity: "medium",
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      neutralBeta: null,
      neutralGamma: null
    },
    running: false,
    gameOver: false,
    score: 0,
    combo: 0,
    comboCooldown: 0,
    timeLeft: 60,
    lastTime: 0,
    nextId: 1,
    particles: [],
    floatTexts: [],
    flashes: [],
    refillQueue: [],
    warningBeepAt: 0,
    screenBurst: 0,
    shake: 0
  };

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.music = null;
      this.volume = Number(volumeSlider.value) / 100;
      this.muted = false;
      this.interval = null;
      this.step = 0;
      this.nextTime = 0;
      this.started = false;
      this.chords = [
        [261.63, 329.63, 392.0],
        [349.23, 440.0, 523.25],
        [392.0, 493.88, 587.33],
        [329.63, 392.0, 493.88]
      ];
      this.melody = [659.25, 0, 587.33, 523.25, 659.25, 783.99, 698.46, 0, 587.33, 523.25, 493.88, 587.33, 659.25, 0, 783.99, 880.0];
      this.bass = [130.81, 174.61, 196.0, 164.81];
    }

    init() {
      if (this.ctx) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.music.gain.value = 0.22;
      this.music.connect(this.master);
      this.master.connect(this.ctx.destination);
    }

    async resume() {
      this.init();
      if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
    }

    setVolume(value) {
      this.volume = value;
      if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.03);
    }

    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.03);
    }

    startMusic() {
      if (!this.ctx || this.started) return;
      this.started = true;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.04;
      this.interval = window.setInterval(() => this.scheduleMusic(), 90);
      this.scheduleMusic();
    }

    stopMusic() {
      this.started = false;
      if (this.interval) window.clearInterval(this.interval);
      this.interval = null;
    }

    scheduleMusic() {
      if (!this.ctx || !this.started) return;
      const beat = 0.24;
      while (this.nextTime < this.ctx.currentTime + 0.45) {
        const chordIndex = Math.floor(this.step / 8) % this.chords.length;
        const chord = this.chords[chordIndex];
        const bassNote = this.bass[chordIndex] / (this.step % 8 < 4 ? 1 : 0.5);
        if (this.step % 8 === 0) chord.forEach((freq, i) => this.note(freq, this.nextTime + i * 0.012, 0.32, "triangle", 0.045, this.music));
        if (this.step % 2 === 0) this.note(bassNote, this.nextTime, 0.18, "sine", 0.07, this.music);
        const lead = this.melody[this.step % this.melody.length];
        if (lead) this.note(lead, this.nextTime, 0.16, "square", 0.035, this.music);
        this.step += 1;
        this.nextTime += beat;
      }
    }

    note(freq, start, duration, type, gainValue, output = this.master, bend = 1) {
      if (!this.ctx || !output) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * bend), start + duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(output);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    }

    noise(start, duration, gainValue, filterFreq) {
      if (!this.ctx || !this.master) return;
      const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      filter.type = "bandpass";
      filter.frequency.value = filterFreq;
      filter.Q.value = 6;
      gain.gain.setValueAtTime(gainValue, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      src.buffer = buffer;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(start);
    }

    sfx(name, amount = 1) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      if (name === "select") this.note(620 + amount * 18, t, 0.07, "sine", 0.09, this.master, 1.18);
      if (name === "link") this.note(720 + amount * 28, t, 0.08, "triangle", 0.08, this.master, 1.22);
      if (name === "pop") {
        this.noise(t, 0.2, 0.12, 1500);
        [523.25, 659.25, 783.99].forEach((f, i) => this.note(f * (1 + amount * 0.015), t + i * 0.035, 0.18, "triangle", 0.09, this.master, 1.3));
      }
      if (name === "combo") [659.25, 783.99, 987.77, 1174.66].forEach((f, i) => this.note(f, t + i * 0.045, 0.16, "square", 0.075, this.master, 1.12));
      if (name === "star") {
        [783.99, 1046.5, 1318.51, 1567.98].forEach((f, i) => this.note(f, t + i * 0.045, 0.22, "sine", 0.1, this.master, 1.12));
        this.noise(t, 0.24, 0.07, 2300);
      }
      if (name === "giant") {
        [196, 261.63, 392, 523.25].forEach((f, i) => this.note(f, t + i * 0.055, 0.3, "sawtooth", 0.07, this.master, 1.3));
        this.noise(t, 0.3, 0.1, 620);
      }
      if (name === "warn") this.note(880, t, 0.12, "sawtooth", 0.07, this.master, 0.78);
      if (name === "end") [523.25, 493.88, 392.0, 261.63].forEach((f, i) => this.note(f, t + i * 0.12, 0.28, "triangle", 0.11, this.master, 0.92));
    }
  }

  const audio = new AudioEngine();

  function rand(max) {
    return Math.floor(Math.random() * max);
  }

  function makePiece(type = rand(TYPES.length), delay = 0, initialY = null, options = {}) {
    const isGiant = Boolean(options.giant);
    const radius = isGiant ? Math.min(RADIUS * Math.sqrt(10), W * 0.235) : RADIUS * (0.92 + Math.random() * 0.1);
    return {
      id: state.nextId++,
      type,
      isGiant,
      chainWeight: isGiant ? 10 : 1,
      x: radius + 12 + Math.random() * (W - radius * 2 - 24),
      y: initialY ?? (-radius - 30 - Math.random() * 180),
      vx: (Math.random() - 0.5) * 42,
      vy: 35 + Math.random() * 70,
      radius,
      angle: (Math.random() - 0.5) * 0.16,
      angularVelocity: (Math.random() - 0.5) * 0.42,
      driftPhase: Math.random() * Math.PI * 2,
      driftSpeed: 0.75 + Math.random() * 0.75,
      spawnDelay: delay,
      scale: 1,
      pop: 0,
      vanish: false,
      vanishTime: 0,
      wobble: Math.random() * Math.PI * 2,
      born: performance.now()
    };
  }

  function shuffle(values) {
    for (let i = values.length - 1; i > 0; i -= 1) {
      const j = rand(i + 1);
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  }

  function resetBoard() {
    state.pieces = [];
    state.items = [];
    state.selected = [];
    state.particles = [];
    state.floatTexts = [];
    state.flashes = [];
    state.refillQueue = [];
    state.shake = 0;
    state.nextId = 1;
    const featuredType = rand(TYPES.length);
    const initialTypes = Array(10).fill(featuredType);
    TYPES.forEach((_, type) => {
      if (type !== featuredType) initialTypes.push(type, type);
    });
    shuffle(initialTypes);
    for (let i = 0; i < PIECE_COUNT; i += 1) {
      const delay = i * 0.035 + Math.random() * 0.18;
      state.pieces.push(makePiece(initialTypes[i], delay, -RADIUS - 28 - Math.random() * 150));
    }
  }

  function startGame() {
    audio.resume().then(() => audio.startMusic());
    state.tilt.enabled = state.tilt.permissionGranted;
    state.tilt.x = 0;
    state.tilt.y = 0;
    state.tilt.targetX = 0;
    state.tilt.targetY = 0;
    state.tilt.neutralBeta = null;
    state.tilt.neutralGamma = null;
    if (state.tilt.enabled) {
      window.removeEventListener("deviceorientation", handleOrientation);
      window.addEventListener("deviceorientation", handleOrientation, { passive: true });
      motionStatus.textContent = "傾き操作：オン";
    }
    resetBoard();
    state.running = true;
    state.gameOver = false;
    state.score = 0;
    state.combo = 0;
    state.comboCooldown = 0;
    state.timeLeft = 60;
    state.warningBeepAt = 0;
    state.screenBurst = 0;
    scoreEl.textContent = "0";
    comboEl.textContent = "0";
    timeEl.textContent = "60";
    timerStat.classList.remove("warning");
    titleOverlay.classList.remove("active");
    resultOverlay.classList.remove("active");
    startButton.disabled = true;
  }

  function endGame() {
    if (!state.running) return;
    state.running = false;
    state.gameOver = true;
    state.tilt.enabled = false;
    state.tilt.targetX = 0;
    state.tilt.targetY = 0;
    state.selected = [];
    state.screenBurst = 1;
    finalScoreEl.textContent = String(state.score);
    resultOverlay.classList.add("active");
    startButton.disabled = false;
    timerStat.classList.remove("warning");
    audio.sfx("end");
    for (let i = 0; i < 130; i += 1) {
      state.particles.push({
        x: W / 2,
        y: H / 2,
        vx: Math.cos(i * 2.399) * (1.4 + Math.random() * 5.5),
        vy: Math.sin(i * 2.399) * (1.4 + Math.random() * 5.5),
        life: 1,
        size: 3 + Math.random() * 6,
        color: i % 2 ? "#fff178" : "#83f4ff"
      });
    }
  }

  function pieceAtPoint(x, y) {
    let closest = null;
    let closestDistance = Infinity;
    state.pieces.forEach((piece) => {
      if (!isSelectable(piece)) return;
      const distance = Math.hypot(x - piece.x, y - piece.y);
      if (distance <= piece.radius * 1.18 && distance < closestDistance) {
        closest = piece;
        closestDistance = distance;
      }
    });
    return closest;
  }

  function makeClockOrb(x, y) {
    return {
      id: `orb-${state.nextId++}`,
      x: clamp(x, RADIUS, W - RADIUS),
      y: clamp(y, RADIUS, H - RADIUS),
      radius: RADIUS * 0.7,
      pulse: Math.random() * Math.PI * 2,
      rotation: 0,
      spawnDelay: 0.2
    };
  }

  function itemAtPoint(x, y) {
    return state.items.find((item) => item.spawnDelay <= 0 && Math.hypot(x - item.x, y - item.y) <= item.radius * 1.45) || null;
  }

  function burstPiece(piece, centerX, centerY, particleCount = 10) {
    if (piece.vanish) return;
    piece.vanish = true;
    piece.vanishTime = 0.19;
    piece.pop = piece.isGiant ? 2.3 : 1.8;
    piece.vx += (piece.x - centerX) * 1.5;
    piece.vy += (piece.y - centerY) * 1.5 - 60;
    for (let i = 0; i < particleCount; i += 1) {
      state.particles.push({
        x: piece.x + (Math.random() - 0.5) * piece.radius,
        y: piece.y + (Math.random() - 0.5) * piece.radius,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5 - 1,
        life: 0.7 + Math.random() * 0.3,
        size: 1.5 + Math.random() * 3,
        color: TYPES[piece.type].glow
      });
    }
  }

  function activateClockOrb(orb) {
    if (!state.running) return;
    state.items = state.items.filter((item) => item.id !== orb.id);
    const blastRadius = RADIUS * 3.1;
    const targets = state.pieces.filter((piece) => isSelectable(piece) && Math.hypot(piece.x - orb.x, piece.y - orb.y) <= blastRadius + piece.radius * 0.35);
    const giantCount = targets.filter((piece) => piece.isGiant).length;
    targets.forEach((piece) => burstPiece(piece, orb.x, orb.y, piece.isGiant ? 18 : 8));
    targets.forEach((_, index) => state.refillQueue.push({ delay: 0.16 + index * 0.08, type: rand(TYPES.length) }));

    const points = 500 + targets.length * 120 + giantCount * 1800;
    state.score += points;
    state.timeLeft = Math.min(99, state.timeLeft + 3);
    scoreEl.textContent = String(state.score);
    timeEl.textContent = String(Math.ceil(state.timeLeft));
    state.floatTexts.push({ x: orb.x, y: orb.y - 10, text: `+${points} / +3秒`, life: 1.2, color: "#9ffcff", size: 24 });
    state.flashes.push({ x: W / 2, y: H * 0.28, life: 1, text: "クロックオーブ！", big: true });
    state.screenBurst = Math.max(state.screenBurst, 0.75);
    state.shake = Math.max(state.shake, 0.35);
    audio.sfx("star");
    for (let i = 0; i < 42; i += 1) {
      const angle = (i / 42) * Math.PI * 2;
      state.particles.push({
        x: orb.x,
        y: orb.y,
        vx: Math.cos(angle) * (2 + Math.random() * 4),
        vy: Math.sin(angle) * (2 + Math.random() * 4),
        life: 0.8 + Math.random() * 0.25,
        size: 2 + Math.random() * 3,
        color: i % 2 ? "#9ffcff" : "#fff178"
      });
    }
  }

  function isSelectable(piece) {
    return !piece.vanish && piece.spawnDelay <= 0 && piece.y > -piece.radius * 0.25;
  }

  function distanceToSegment(piece, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return { distance: Math.hypot(piece.x - from.x, piece.y - from.y), t: 0 };
    const t = Math.max(0, Math.min(1, ((piece.x - from.x) * dx + (piece.y - from.y) * dy) / lengthSquared));
    const x = from.x + dx * t;
    const y = from.y + dy * t;
    return { distance: Math.hypot(piece.x - x, piece.y - y), t };
  }

  function trySelectAlongSegment(from, to) {
    const candidates = state.pieces
      .filter(isSelectable)
      .map((piece) => ({ piece, ...distanceToSegment(piece, from, to) }))
      .filter((item) => item.distance <= Math.max(PICK_RADIUS, item.piece.radius * 1.18))
      .sort((a, b) => a.t - b.t || a.distance - b.distance);

    const previous = state.selected[state.selected.length - 2];
    if (previous && candidates.some((candidate) => candidate.piece.id === previous.id)) {
      trySelect(previous);
      return;
    }

    for (const candidate of candidates) trySelect(candidate.piece);
  }

  function trySelect(piece) {
    if (!state.running || !piece) return;
    const selected = state.selected;
    if (!selected.length) {
      selected.push(piece);
      piece.pop = 1;
      audio.sfx("select", 1);
      return;
    }
    const last = selected[selected.length - 1];
    const prev = selected[selected.length - 2];
    if (prev && piece.id === prev.id) {
      const removed = selected.pop();
      removed.pop = 0.35;
      audio.sfx("select", selected.length);
      return;
    }
    const distanceFromLast = Math.hypot(piece.x - last.x, piece.y - last.y);
    const allowedDistance = Math.max(LINK_DISTANCE, last.radius + piece.radius + RADIUS * 1.15);
    if (piece.type !== selected[0].type || piece.id === last.id || selected.some((p) => p.id === piece.id) || distanceFromLast > allowedDistance) return;
    selected.push(piece);
    piece.pop = 1;
    audio.sfx("link", selected.length);
    if (selected.length >= 7) addLongChainAura(piece.x, piece.y, selected.length);
  }

  function addLongChainAura(x, y, length) {
    state.flashes.push({ x, y, life: 1, text: `${length} LINK!`, big: length >= 10 });
    for (let i = 0; i < 8; i += 1) {
      state.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        life: 0.6,
        size: 2 + Math.random() * 4,
        color: "#fff587"
      });
    }
  }

  function releaseSelection() {
    if (!state.selected.length) return;
    if (state.selected.length >= 3) clearSelection();
    else state.selected.forEach((p) => { p.pop = 0.25; });
    state.selected = [];
  }

  function clearSelection() {
    const chain = [...state.selected];
    const length = chain.length;
    const giantCount = chain.filter((piece) => piece.isGiant).length;
    const normalCount = length - giantCount;
    state.combo += 1;
    state.comboCooldown = 3.2;

    const basePoints = normalCount * 100 + giantCount * 1400;
    const chainBonus = length >= 10 ? 2500 : length >= 5 ? 600 : 0;
    const giantBonus = giantCount * 1800;
    const comboMultiplier = 1 + (state.combo - 1) * 0.25;
    const earnedPoints = Math.floor((basePoints + chainBonus + giantBonus) * comboMultiplier);
    state.score += earnedPoints;
    scoreEl.textContent = String(state.score);
    comboEl.textContent = String(state.combo);
    audio.sfx("pop", length);
    if (state.combo >= 2) audio.sfx("combo", state.combo);

    const cx = chain.reduce((sum, p) => sum + p.x, 0) / length;
    const cy = chain.reduce((sum, p) => sum + p.y, 0) / length;
    state.floatTexts.push({ x: cx, y: cy, text: `+${earnedPoints}`, life: 1, color: "#fff178", size: Math.min(36, 18 + length) });
    if (state.combo >= 2) state.flashes.push({ x: W / 2, y: H * 0.32, life: 1, text: `${state.combo} COMBO`, big: true });

    chain.forEach((piece) => burstPiece(piece, cx, cy, piece.isGiant ? 20 : 10));

    const createsGiant = length >= 10;
    const refillCount = length - (createsGiant ? 1 : 0);
    for (let index = 0; index < refillCount; index += 1) {
      state.refillQueue.push({
        delay: 0.18 + index * 0.105 + Math.random() * 0.06,
        type: rand(TYPES.length)
      });
    }

    if (length >= 5) {
      state.items.push(makeClockOrb(cx, cy));
      state.flashes.push({ x: W / 2, y: H * 0.23, life: 1, text: "クロックオーブ", big: length >= 10 });
      state.screenBurst = Math.max(state.screenBurst, length >= 10 ? 0.85 : 0.48);
      audio.sfx("star");
      const sparkleCount = length >= 10 ? 38 : 24;
      for (let i = 0; i < sparkleCount; i += 1) {
        state.particles.push({
          x: cx,
          y: cy,
          vx: (Math.random() - 0.5) * 6,
          vy: (Math.random() - 0.5) * 6,
          life: 0.65 + Math.random() * 0.3,
          size: 1.5 + Math.random() * 3,
          color: i % 2 ? "#9ffcff" : "#fff178"
        });
      }
    }

    if (createsGiant) {
      state.refillQueue.push({
        delay: 0.3,
        type: chain[0].type,
        giant: true,
        x: cx,
        y: cy
      });
    }
  }

  function updateRefill(dt) {
    state.refillQueue.forEach((item) => { item.delay -= dt; });
    const ready = state.refillQueue.filter((item) => item.delay <= 0);
    state.refillQueue = state.refillQueue.filter((item) => item.delay > 0);
    ready.forEach((item) => {
      const piece = makePiece(item.type, 0, item.giant ? item.y : null, { giant: item.giant });
      if (item.giant) {
        piece.x = clamp(item.x, piece.radius + 5, W - piece.radius - 5);
        piece.y = clamp(item.y, piece.radius + 5, H - piece.radius - 5);
        piece.vx = 0;
        piece.vy = -45;
        piece.pop = 2.2;
        state.shake = Math.max(state.shake, 0.85);
        state.screenBurst = Math.max(state.screenBurst, 0.9);
        state.flashes.push({ x: W / 2, y: H * 0.46, life: 1, text: "メガまる！", big: true });
        audio.sfx("giant");
      }
      state.pieces.push(piece);
    });
  }

  function touchForEvent(event) {
    if (!event.changedTouches && !event.touches) return event;
    const touches = [...(event.touches || []), ...(event.changedTouches || [])];
    if (state.activeTouchId === null) return touches[0] || null;
    return touches.find((touch) => touch.identifier === state.activeTouchId) || null;
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    const point = touchForEvent(event);
    if (!point) return null;
    return {
      x: (point.clientX - rect.left) * (W / rect.width),
      y: (point.clientY - rect.top) * (H / rect.height)
    };
  }

  function onPointerDown(event) {
    const isTouch = event.type.startsWith("touch");
    if (!isTouch && performance.now() - state.lastTouchTime < 800) return;
    if (!state.running) return;
    if (isTouch) {
      if (state.pointer.active) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      state.activeTouchId = touch.identifier;
      state.lastTouchTime = performance.now();
    }
    event.preventDefault();
    const pos = pointerPosition(event);
    if (!pos) return;
    const item = itemAtPoint(pos.x, pos.y);
    if (item) {
      activateClockOrb(item);
      state.activeTouchId = null;
      return;
    }
    state.pointer = { ...pos, prevX: pos.x, prevY: pos.y, active: true };
    trySelect(pieceAtPoint(pos.x, pos.y));
  }

  function onPointerMove(event) {
    if (!state.pointer.active) return;
    event.preventDefault();
    const pos = pointerPosition(event);
    if (!pos) return;
    if (event.type.startsWith("touch")) state.lastTouchTime = performance.now();
    const from = { x: state.pointer.x, y: state.pointer.y };
    const to = { x: pos.x, y: pos.y };
    state.pointer.prevX = state.pointer.x;
    state.pointer.prevY = state.pointer.y;
    state.pointer.x = pos.x;
    state.pointer.y = pos.y;
    trySelectAlongSegment(from, to);
  }

  function onPointerUp(event) {
    if (!state.pointer.active) return;
    if (event.type.startsWith("touch") && ![...(event.changedTouches || [])].some((touch) => touch.identifier === state.activeTouchId)) return;
    event.preventDefault();
    state.pointer.active = false;
    state.activeTouchId = null;
    if (event.type.startsWith("touch")) state.lastTouchTime = performance.now();
    releaseSelection();
  }

  function onPointerCancel(event) {
    if (!state.pointer.active) return;
    if (![...(event.changedTouches || [])].some((touch) => touch.identifier === state.activeTouchId)) return;
    event.preventDefault();
    state.selected.forEach((piece) => { piece.pop = 0.2; });
    state.selected = [];
    state.pointer.active = false;
    state.activeTouchId = null;
    state.lastTouchTime = performance.now();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function handleOrientation(event) {
    if (!state.tilt.enabled || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    if (state.tilt.neutralBeta === null || state.tilt.neutralGamma === null) {
      state.tilt.neutralBeta = event.beta;
      state.tilt.neutralGamma = event.gamma;
    }

    state.tilt.targetX = clamp((event.gamma - state.tilt.neutralGamma) / 24, -1, 1);
    state.tilt.targetY = clamp((event.beta - state.tilt.neutralBeta) / 30, -1, 1);
  }

  async function enableTiltControl() {
    motionButton.disabled = true;
    motionStatus.textContent = "傾きセンサーを確認中…";

    try {
      const OrientationEvent = window.DeviceOrientationEvent;
      if (!OrientationEvent) {
        motionStatus.textContent = "この端末では傾き操作を利用できません";
        motionButton.textContent = "傾き操作は利用できません";
        return;
      }

      if (typeof OrientationEvent.requestPermission === "function") {
        const permission = await OrientationEvent.requestPermission();
        if (permission !== "granted") {
          motionStatus.textContent = "許可されませんでした。指操作で遊べます";
          motionButton.textContent = "傾き操作を有効にする";
          motionButton.disabled = false;
          return;
        }
      }

      state.tilt.permissionGranted = true;
      state.tilt.enabled = state.running;
      motionButton.textContent = "傾き操作：準備完了";
      motionStatus.textContent = state.running ? "傾き操作：オン" : "スタート後に傾き操作が有効になります";
      if (state.running) {
        state.tilt.neutralBeta = null;
        state.tilt.neutralGamma = null;
        window.removeEventListener("deviceorientation", handleOrientation);
        window.addEventListener("deviceorientation", handleOrientation, { passive: true });
      }
    } catch (error) {
      state.tilt.enabled = false;
      state.tilt.permissionGranted = false;
      motionButton.disabled = false;
      motionButton.textContent = "傾き操作を有効にする";
      motionStatus.textContent = "傾き操作を開始できません。指操作で遊べます";
    }
  }

  function resolveCollisions() {
    const pieces = state.pieces.filter((piece) => isSelectable(piece));
    for (let i = 0; i < pieces.length; i += 1) {
      for (let j = i + 1; j < pieces.length; j += 1) {
        const a = pieces[i];
        const b = pieces[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const minimum = (a.radius + b.radius) * 0.91;
        if (distance >= minimum) continue;
        if (distance < 0.01) {
          dx = Math.random() - 0.5;
          dy = -1;
          distance = Math.hypot(dx, dy);
        }

        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minimum - distance;
        const correction = overlap * 0.52;
        a.x -= nx * correction;
        a.y -= ny * correction;
        b.x += nx * correction;
        b.y += ny * correction;

        const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relativeVelocity < 0) {
          const impulse = -relativeVelocity * 0.38;
          a.vx -= nx * impulse;
          a.vy -= ny * impulse;
          b.vx += nx * impulse;
          b.vy += ny * impulse;
        }
      }
    }
  }

  function updatePieces(dt) {
    const now = performance.now() * 0.001;
    const tiltEase = Math.min(1, dt * 7.5);
    state.tilt.x += (state.tilt.targetX - state.tilt.x) * tiltEase;
    state.tilt.y += (state.tilt.targetY - state.tilt.y) * tiltEase;
    const sensitivity = TILT_MULTIPLIERS[state.tilt.sensitivity];
    const maxSpeed = state.tilt.sensitivity === "high" ? 175 : state.tilt.sensitivity === "low" ? 115 : 145;
    state.pieces.forEach((piece) => {
      if (piece.spawnDelay > 0) {
        piece.spawnDelay -= dt;
        return;
      }

      piece.wobble += dt * (2.7 + piece.driftSpeed);
      piece.angle += piece.angularVelocity * dt;
      piece.pop *= Math.pow(0.018, dt);

      if (piece.vanish) {
        piece.vanishTime -= dt;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.vy += GRAVITY * 0.18 * dt;
        piece.angle += dt * 4.5;
        return;
      }

      const selected = state.selected.some((item) => item.id === piece.id);
      const tiltStrength = selected ? 0.24 : 1;
      const gravity = state.tilt.enabled ? GRAVITY * 0.72 : GRAVITY;
      piece.vy += gravity * dt;
      piece.vx += state.tilt.x * 360 * sensitivity * tiltStrength * dt;
      piece.vy += state.tilt.y * 650 * sensitivity * tiltStrength * dt;
      piece.vx += Math.sin(now * piece.driftSpeed + piece.driftPhase) * 5.5 * dt;
      piece.vx *= Math.pow(0.76, dt);
      piece.angularVelocity *= Math.pow(0.7, dt);
      piece.vx = clamp(piece.vx, -maxSpeed, maxSpeed);
      piece.vy = clamp(piece.vy, -maxSpeed, maxSpeed);
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;

      const left = piece.radius + 7;
      const right = W - piece.radius - 7;
      if (piece.x < left) {
        piece.x = left;
        piece.vx = Math.abs(piece.vx) * 0.42;
        piece.angularVelocity += 0.12;
      } else if (piece.x > right) {
        piece.x = right;
        piece.vx = -Math.abs(piece.vx) * 0.42;
        piece.angularVelocity -= 0.12;
      }

      const floor = H - piece.radius - 8;
      if (piece.y > floor) {
        piece.y = floor;
        if (piece.vy > 35) piece.vy *= -0.2;
        else piece.vy = 0;
        piece.vx *= 0.91;
        piece.angularVelocity += piece.vx * 0.0008;
      }
    });

    resolveCollisions();
    resolveCollisions();
    state.pieces = state.pieces.filter((piece) => !piece.vanish || piece.vanishTime > 0);
  }

  function updateItems(dt) {
    state.items.forEach((item) => {
      item.spawnDelay -= dt;
      item.pulse += dt * 4.2;
      item.rotation += dt * 1.3;
    });
  }

  function update(dt) {
    if (state.running) {
      updateRefill(dt);
      state.timeLeft = Math.max(0, state.timeLeft - dt);
      const displayTime = Math.ceil(state.timeLeft);
      timeEl.textContent = String(displayTime);
      if (displayTime <= 10) {
        timerStat.classList.add("warning");
        if (displayTime > 0 && displayTime !== state.warningBeepAt) {
          state.warningBeepAt = displayTime;
          audio.sfx("warn");
        }
      }
      if (state.timeLeft <= 0) endGame();
      if (!state.selected.length && state.combo > 0) {
        state.comboCooldown = Math.max(0, state.comboCooldown - dt);
        if (state.comboCooldown <= 0) {
          state.combo = 0;
          comboEl.textContent = "0";
        }
      }
    }

    updatePieces(dt);
    updateItems(dt);

    state.particles = state.particles.filter((p) => {
      p.life -= dt * 1.55;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      return p.life > 0;
    });
    state.floatTexts = state.floatTexts.filter((t) => {
      t.life -= dt * 0.85;
      t.y -= dt * 56;
      return t.life > 0;
    });
    state.flashes = state.flashes.filter((f) => {
      f.life -= dt * 1.08;
      return f.life > 0;
    });
    state.screenBurst = Math.max(0, state.screenBurst - dt * 0.45);
    state.shake = Math.max(0, state.shake - dt * 1.7);
  }

  function drawBackground() {
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#3247b8");
    g.addColorStop(0.46, "#22a9c7");
    g.addColorStop(1, "#ffb053");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 22; i += 1) {
      const x = (i * 137 + 43) % W;
      const y = (i * 83 + 72) % H;
      const r = 3 + (i % 5) * 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPiece(piece) {
    if (piece.spawnDelay > 0) return;
    const selected = state.selected.some((p) => p.id === piece.id);
    const info = TYPES[piece.type];
    const time = performance.now() * 0.001;
    const bounce = Math.sin(piece.wobble) * 2.2;
    const sway = Math.sin(time * piece.driftSpeed + piece.driftPhase) * 1.8;
    const selectedPulse = selected ? 0.1 + Math.sin(time * 9 + piece.id) * 0.025 : 0;
    const vanishProgress = piece.vanish ? 1 - Math.max(0, piece.vanishTime) / 0.19 : 0;
    const scale = 1 + piece.pop * 0.14 + selectedPulse + vanishProgress * 0.28;
    const x = piece.x + sway + (selected ? Math.sin(time * 19 + piece.id) * 1.5 : 0);
    const y = piece.y + bounce;
    const r = piece.radius * scale;
    const pieceAlpha = piece.vanish ? Math.max(0, piece.vanishTime / 0.19) : 1;

    ctx.save();
    ctx.globalAlpha = pieceAlpha;
    ctx.translate(x, y);
    ctx.rotate(piece.angle + Math.sin(piece.wobble * 0.55) * 0.025);
    if (piece.isGiant) {
      ctx.save();
      ctx.globalAlpha = pieceAlpha * (0.48 + Math.sin(time * 5) * 0.12);
      ctx.strokeStyle = "#fff178";
      ctx.lineWidth = 5;
      ctx.shadowColor = info.glow;
      ctx.shadowBlur = 28;
      ctx.beginPath();
      ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (selected) {
      ctx.shadowColor = info.glow;
      ctx.shadowBlur = 25;
    }
    ctx.fillStyle = "rgba(23, 27, 76, 0.25)";
    ctx.beginPath();
    ctx.ellipse(4, r * 0.78, r * 0.82, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    drawFeatureBack(info, r);

    const body = ctx.createRadialGradient(-r * 0.3, -r * 0.42, r * 0.08, 0, 0, r);
    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.12, info.glow);
    body.addColorStop(0.36, info.main);
    body.addColorStop(1, info.shade);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.42)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.globalAlpha = pieceAlpha * 0.56;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(-r * 0.32, -r * 0.42, r * 0.22, r * 0.12, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = pieceAlpha;

    drawFace(info, r, piece.type);
    drawFeatureFront(info, r);

    if (piece.isGiant) {
      ctx.strokeStyle = "rgba(49,36,90,0.78)";
      ctx.lineWidth = Math.max(4, r * 0.045);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-r * 0.44, -r * 0.28);
      ctx.lineTo(-r * 0.22, -r * 0.34);
      ctx.moveTo(r * 0.22, -r * 0.34);
      ctx.lineTo(r * 0.44, -r * 0.28);
      ctx.stroke();
      ctx.fillStyle = "#fff178";
      for (let i = 0; i < 3; i += 1) {
        const angle = -Math.PI / 2 + (i - 1) * 0.7;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * r * 0.68, Math.sin(angle) * r * 0.68, r * 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (selected) {
      ctx.strokeStyle = "#fff9a8";
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(0, 0, r + 5 + Math.sin(performance.now() / 120) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFeatureBack(info, r) {
    ctx.fillStyle = info.shade;
    if (info.feature === "ears") {
      [-0.55, 0.55].forEach((side) => {
        ctx.beginPath();
        ctx.ellipse(side * r * 0.72, -r * 0.72, r * 0.23, r * 0.34, side * 0.6, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    if (info.feature === "horn") {
      ctx.fillStyle = "#fff2aa";
      ctx.beginPath();
      ctx.moveTo(-r * 0.16, -r * 0.82);
      ctx.quadraticCurveTo(0, -r * 1.34, r * 0.17, -r * 0.82);
      ctx.closePath();
      ctx.fill();
    }
    if (info.feature === "sprout") {
      ctx.fillStyle = "#4abc5b";
      ctx.beginPath();
      ctx.ellipse(-r * 0.15, -r * 1.02, r * 0.22, r * 0.12, -0.7, 0, Math.PI * 2);
      ctx.ellipse(r * 0.16, -r * 1.02, r * 0.22, r * 0.12, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFeatureFront(info, r) {
    if (info.feature === "cap") {
      ctx.fillStyle = "#5d48b7";
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.74, r * 0.54, r * 0.16, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff178";
      ctx.fillRect(-r * 0.1, -r * 0.95, r * 0.2, r * 0.16);
    }
    if (info.feature === "dots") {
      ctx.fillStyle = "rgba(255,255,255,0.38)";
      [[-0.48, -0.28], [0.46, -0.2], [-0.3, 0.42], [0.28, 0.48]].forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x * r, y * r, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  function drawFace(info, r, type) {
    ctx.fillStyle = "rgba(45,35,72,0.86)";
    const eyeY = -r * 0.1;
    const eyeX = r * 0.33;
    if (type === 2) {
      ctx.lineWidth = r * 0.07;
      ctx.strokeStyle = "rgba(45,35,72,0.86)";
      [-eyeX, eyeX].forEach((x) => {
        ctx.beginPath();
        ctx.arc(x, eyeY, r * 0.12, 0.15, Math.PI - 0.15);
        ctx.stroke();
      });
    } else {
      [-eyeX, eyeX].forEach((x) => {
        ctx.beginPath();
        ctx.ellipse(x, eyeY, r * 0.1, r * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.beginPath();
        ctx.arc(x - r * 0.025, eyeY - r * 0.05, r * 0.028, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(45,35,72,0.86)";
      });
    }
    ctx.fillStyle = info.cheek;
    [-0.48, 0.48].forEach((x) => {
      ctx.beginPath();
      ctx.ellipse(x * r, r * 0.2, r * 0.15, r * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = "rgba(45,35,72,0.78)";
    ctx.lineWidth = r * 0.055;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (type === 1) ctx.arc(0, r * 0.16, r * 0.18, 0.1, Math.PI - 0.1);
    else if (type === 4) ctx.moveTo(-r * 0.1, r * 0.18), ctx.lineTo(0, r * 0.28), ctx.lineTo(r * 0.1, r * 0.18);
    else ctx.arc(0, r * 0.16, r * 0.2, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }

  function drawConnections() {
    if (!state.selected.length) return;
    const points = state.selected.map((p) => ({ x: p.x, y: p.y }));
    if (state.pointer.active) points.push({ x: state.pointer.x, y: state.pointer.y });
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "#fff178";
    ctx.shadowBlur = Math.min(42, 14 + state.selected.length * 3.2);
    ctx.strokeStyle = `rgba(255, 245, 120, ${Math.min(0.82, 0.34 + state.selected.length * 0.045)})`;
    ctx.lineWidth = Math.min(25, 14 + state.selected.length * 0.75);
    drawPath(points);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.min(8, 4.5 + state.selected.length * 0.2);
    drawPath(points);
    ctx.stroke();
    ctx.restore();
  }

  function drawItems() {
    state.items.forEach((item) => {
      if (item.spawnDelay > 0) return;
      const pulse = 1 + Math.sin(item.pulse) * 0.08;
      const r = item.radius * pulse;
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(item.rotation);
      ctx.shadowColor = "#78f5ff";
      ctx.shadowBlur = 24;

      const glow = ctx.createRadialGradient(-r * 0.25, -r * 0.3, 1, 0, 0, r);
      glow.addColorStop(0, "#ffffff");
      glow.addColorStop(0.32, "#a9fbff");
      glow.addColorStop(0.72, "#56bdf4");
      glow.addColorStop(1, "#574bd1");
      ctx.fillStyle = glow;
      ctx.beginPath();
      for (let i = 0; i < 16; i += 1) {
        const angle = -Math.PI / 2 + (i / 16) * Math.PI * 2;
        const pointRadius = i % 2 === 0 ? r : r * 0.72;
        const x = Math.cos(angle) * pointRadius;
        const y = Math.sin(angle) * pointRadius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(39,42,112,0.82)";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff178";
      ctx.lineWidth = Math.max(2, r * 0.1);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r * 0.3);
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 0.24, r * 0.12);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawPath(points) {
    ctx.beginPath();
    if (!points.length) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i += 1) {
      const midpointX = (points[i].x + points[i + 1].x) * 0.5;
      const midpointY = (points[i].y + points[i + 1].y) * 0.5;
      ctx.quadraticCurveTo(points[i].x, points[i].y, midpointX, midpointY);
    }
    if (points.length > 1) {
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    }
  }

  function drawParticles() {
    state.particles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * Math.max(0.25, p.life), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawTexts() {
    state.floatTexts.forEach((t) => {
      ctx.save();
      ctx.globalAlpha = Math.min(1, t.life * 1.6);
      ctx.fillStyle = t.color;
      ctx.strokeStyle = "rgba(55,36,90,0.82)";
      ctx.lineWidth = 6;
      ctx.font = `900 ${t.size}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    });
    state.flashes.forEach((f) => {
      ctx.save();
      const size = f.big ? 58 : 34;
      ctx.globalAlpha = Math.min(1, f.life * 1.35);
      ctx.translate(f.x, f.y);
      ctx.scale(1 + (1 - f.life) * 0.38, 1 + (1 - f.life) * 0.38);
      ctx.fillStyle = "#fff178";
      ctx.strokeStyle = "rgba(91,44,131,0.82)";
      ctx.lineWidth = 8;
      ctx.font = `900 ${size}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "#fff178";
      ctx.shadowBlur = 24;
      ctx.strokeText(f.text, 0, 0);
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    });
  }

  function drawScreenBurst() {
    if (state.screenBurst <= 0) return;
    ctx.save();
    ctx.globalAlpha = state.screenBurst * 0.5;
    const g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.8);
    g.addColorStop(0, "#fff7a8");
    g.addColorStop(0.32, "rgba(255,122,188,0.52)");
    g.addColorStop(1, "rgba(44,31,116,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function render(time) {
    const dt = Math.min(0.033, (time - (state.lastTime || time)) / 1000);
    state.lastTime = time;
    update(dt);
    drawBackground();
    ctx.save();
    if (state.shake > 0) {
      const strength = state.shake * 7;
      ctx.translate((Math.random() - 0.5) * strength, (Math.random() - 0.5) * strength);
    }
    drawConnections();
    state.pieces.forEach(drawPiece);
    drawItems();
    drawParticles();
    drawTexts();
    ctx.restore();
    drawScreenBurst();
    requestAnimationFrame(render);
  }

  canvas.addEventListener("mousedown", onPointerDown);
  canvas.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  canvas.addEventListener("touchstart", onPointerDown, { passive: false });
  canvas.addEventListener("touchmove", onPointerMove, { passive: false });
  window.addEventListener("touchend", onPointerUp, { passive: false });
  window.addEventListener("touchcancel", onPointerCancel, { passive: false });

  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", startGame);
  startFromTitle.addEventListener("click", startGame);
  restartFromResult.addEventListener("click", startGame);
  motionButton.addEventListener("click", enableTiltControl);
  sensitivityButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.tilt.sensitivity = button.dataset.sensitivity;
      sensitivityButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    });
  });
  muteButton.addEventListener("click", () => {
    audio.setMuted(!audio.muted);
    muteButton.textContent = audio.muted ? "Muted" : "Sound On";
    muteButton.setAttribute("aria-pressed", String(audio.muted));
  });
  volumeSlider.addEventListener("input", () => audio.setVolume(Number(volumeSlider.value) / 100));

  resetBoard();
  startButton.disabled = false;
  requestAnimationFrame(render);
})();
