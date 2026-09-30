/* ============================================================
   Sound Room · AudioEngine
   - 循环音频素材（CC0）加载与无缝循环
   - 淡入淡出（指数曲线，绝不突兀）
   - 合成音：猫呼噜 / 柴火噼啪 / 钟摆滴答
   ============================================================ */
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = {};
    this.tracks = {};   // name -> { gain, stop(), baseVol }
    this._noise = null;
  }

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get now() { return this.ctx.currentTime; }

  /* 1 秒白噪声缓冲，供合成音使用 */
  get noiseBuffer() {
    if (!this._noise) {
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }

  async loadBuffer(name, url) {
    if (this.buffers[name]) return this.buffers[name];
    const ab = await (await fetch(url)).arrayBuffer();
    this.buffers[name] = await this.ctx.decodeAudioData(ab);
    return this.buffers[name];
  }

  _register(name, gainNode, stopFn, baseVol) {
    this.tracks[name] = { gain: gainNode, stop: stopFn, baseVol: baseVol ?? 0.7 };
  }

  setVolume(name, v, ramp = 0.15) {
    const t = this.tracks[name];
    if (!t) return;
    t.baseVol = v;
    const g = t.gain.gain;
    g.cancelScheduledValues(this.now);
    g.setValueAtTime(g.value, this.now);
    g.linearRampToValueAtTime(Math.max(v, 0.0001), this.now + ramp);
  }

  /* 主音量（睡眠定时渐弱用） */
  setMaster(v, ramp = 0.5) {
    if (!this.ctx) return;
    const g = this.master.gain;
    g.cancelScheduledValues(this.now);
    g.setValueAtTime(Math.max(g.value, 0.0001), this.now);
    g.linearRampToValueAtTime(Math.max(v, 0.0001), this.now + ramp);
  }

  fadeOut(name, fade = 1.5) {
    const t = this.tracks[name];
    if (!t) return;
    const g = t.gain.gain;
    g.cancelScheduledValues(this.now);
    g.setValueAtTime(Math.max(g.value, 0.0001), this.now);
    g.exponentialRampToValueAtTime(0.0001, this.now + fade);
    const stopFn = t.stop;
    setTimeout(() => { stopFn(); delete this.tracks[name]; }, fade * 1000 + 100);
  }

  stopAll(fade = 1.5) { Object.keys(this.tracks).forEach(n => this.fadeOut(n, fade)); }

  /* ---------- 素材循环音轨 ---------- */
  async startLoop(name, url, { volume = 0.7, fadeIn = 2, filterFreq = null } = {}) {
    this.ensure();
    if (this.tracks[name]) return;
    const buf = await this.loadBuffer(name, url);
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, this.now);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), this.now + fadeIn);
    let node = src;
    if (filterFreq) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = filterFreq;
      src.connect(f); node = f;
    }
    node.connect(gain); gain.connect(this.master);
    src.start();
    this._register(name, gain, () => { try { src.stop(); } catch (e) {} src.disconnect(); }, volume);
  }

  /* ---------- 合成：猫呼噜 ---------- */
  startPurr(name, { volume = 0.55 } = {}) {
    this.ensure();
    if (this.tracks[name]) return;
    const mod = this.ctx.createGain(); mod.gain.value = 0.55;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 1.35; // 呼噜节奏
    const lfoDepth = this.ctx.createGain(); lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth); lfoDepth.connect(mod.gain);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const o1 = this.ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 26;
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 52;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.35;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(volume, this.now + 2);
    o1.connect(mod); o2.connect(g2); g2.connect(mod);
    mod.connect(lp); lp.connect(out); out.connect(this.master);
    o1.start(); o2.start(); lfo.start();
    this._register(name, out, () => { [o1, o2, lfo].forEach(o => { try { o.stop(); } catch (e) {} }); }, volume);
  }

  /* ---------- 合成：柴火噼啪 ---------- */
  startCrackle(name, { volume = 0.5 } = {}) {
    this.ensure();
    if (this.tracks[name]) return;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(volume, this.now + 2);
    out.connect(this.master);
    let alive = true, timer = null;
    const burst = () => {
      if (!alive) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 3400; bp.Q.value = 9;
      const g = this.ctx.createGain();
      const amp = 0.08 + Math.random() * 0.14;
      g.gain.setValueAtTime(amp, this.now);
      g.gain.exponentialRampToValueAtTime(0.001, this.now + 0.04 + Math.random() * 0.04);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(this.now, Math.random() * 0.8, 0.12);
      timer = setTimeout(burst, 25 + Math.random() * 110);
    };
    burst();
    this._register(name, out, () => { alive = false; clearTimeout(timer); }, volume);
  }

  /* ---------- 合成：雷声（一次性，主响 + 概率回声） ---------- */
  playThunder(volume = 0.6) {
    this.ensure();
    const t0 = this.now;
    const strike = (t, vol, dur) => {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer; src.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(420, t);
      lp.frequency.exponentialRampToValueAtTime(55, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp); lp.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + 0.1);
    };
    strike(t0, volume, 2.5 + Math.random() * 1.5);
    if (Math.random() < 0.6) strike(t0 + 0.7 + Math.random() * 0.9, volume * 0.5, 2);
  }

  /* ---------- 合成：茶炉沸水咕嘟 ---------- */
  startBubble(name, { volume = 0.4 } = {}) {
    this.ensure();
    if (this.tracks[name]) return;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(volume, this.now + 2);
    out.connect(this.master);
    let alive = true, timer = null;
    const blip = () => {
      if (!alive) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 240 + Math.random() * 520; bp.Q.value = 7;
      const g = this.ctx.createGain();
      const amp = 0.05 + Math.random() * 0.1;
      g.gain.setValueAtTime(amp, this.now);
      g.gain.exponentialRampToValueAtTime(0.001, this.now + 0.05 + Math.random() * 0.1);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(this.now, Math.random() * 0.8, 0.18);
      timer = setTimeout(blip, 70 + Math.random() * 240);
    };
    blip();
    this._register(name, out, () => { alive = false; clearTimeout(timer); }, volume);
  }

  /* ---------- 合成：烛火（极轻白噪床 + 偶尔细噼啪） ---------- */
  startCandle(name, { volume = 0.35 } = {}) {
    this.ensure();
    if (this.tracks[name]) return;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(volume, this.now + 2);
    out.connect(this.master);
    // 白噪床（低通压暗）
    const bed = this.ctx.createBufferSource();
    bed.buffer = this.noiseBuffer; bed.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const bedGain = this.ctx.createGain(); bedGain.gain.value = 0.05;
    bed.connect(lp); lp.connect(bedGain); bedGain.connect(out);
    bed.start();
    // 细噼啪
    let alive = true, timer = null;
    const snap = () => {
      if (!alive) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2800 + Math.random() * 2200;
      const g = this.ctx.createGain();
      const amp = 0.03 + Math.random() * 0.07;
      g.gain.setValueAtTime(amp, this.now);
      g.gain.exponentialRampToValueAtTime(0.001, this.now + 0.02 + Math.random() * 0.03);
      src.connect(hp); hp.connect(g); g.connect(out);
      src.start(this.now, Math.random() * 0.8, 0.06);
      timer = setTimeout(snap, 300 + Math.random() * 1600);
    };
    snap();
    this._register(name, out, () => {
      alive = false; clearTimeout(timer);
      try { bed.stop(); } catch (e) {}
    }, volume);
  }

  /* ---------- 合成：钟摆滴答 ---------- */
  startTick(name, { volume = 0.3 } = {}) {
    this.ensure();
    if (this.tracks[name]) return;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(volume, this.now + 1);
    out.connect(this.master);
    let alive = true;
    let tock = false;
    const iv = setInterval(() => {
      if (!alive) return;
      tock = !tock;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = tock ? 2200 : 3200; // 滴答交替
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(tock ? 0.16 : 0.11, this.now);
      g.gain.exponentialRampToValueAtTime(0.001, this.now + 0.025);
      src.connect(hp); hp.connect(g); g.connect(out);
      src.start(this.now, Math.random() * 0.5, 0.03);
    }, 1000);
    this._register(name, out, () => { alive = false; clearInterval(iv); }, volume);
  }
}

window.engine = new AudioEngine();
