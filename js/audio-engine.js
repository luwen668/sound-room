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
    this.muted = false; // 静音总开关（视觉不变，只断声音）
    this._base = 0.9;   // 非静音时的主音量基准
  }

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0.0001 : this._base;
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

  /* 主音量基准（睡眠定时渐弱用）；静音时只记基准不出声 */
  setMaster(v, ramp = 0.5) {
    this._base = v;
    if (this.muted) return;
    this._applyMaster(v, ramp);
  }

  /* 静音总开关 */
  setMuted(m, ramp = 0.3) {
    this.muted = m;
    this._applyMaster(m ? 0 : this._base, ramp);
  }

  _applyMaster(v, ramp = 0.5) {
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
  async startLoop(name, url, { volume = 0.7, fadeIn = 2, filterFreq = null } = {}) {    this.ensure();
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

  /* ---------- 合成：雨（低鸣底噪 + 成簇雨滴拍打，替代"流水感"素材） ---------- */
  startRain(name, { volume = 0.45 } = {}) {
    this.ensure();
    if (this.tracks[name]) return;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(volume, this.now + 2);
    out.connect(this.master);
    // 底噪：白噪 → 低通 = 雨幕的低频轰鸣，LFO 缓慢起伏
    // （底噪要轻，否则会听成"沸腾的低鸣"——雨的主体是上面的雨滴层）
    const bed = this.ctx.createBufferSource();
    bed.buffer = this.noiseBuffer; bed.loop = true;
    const bedLP = this.ctx.createBiquadFilter();
    bedLP.type = 'lowpass'; bedLP.frequency.value = 850; bedLP.Q.value = 0.5;
    const bedGain = this.ctx.createGain(); bedGain.gain.value = 0.08;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.16;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.025;
    lfo.connect(lfoG); lfoG.connect(bedGain.gain);
    bed.connect(bedLP); bedLP.connect(bedGain); bedGain.connect(out);
    bed.start(); lfo.start();
    // 雨滴：2-4kHz 带通短爆发，成簇落下（簇内密集、簇间停顿）
    let alive = true, timer = null, cluster = 0;
    const drop = () => {
      if (!alive) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1600 + Math.random() * 2800;
      bp.Q.value = 1.2;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.05 + Math.random() * 0.08, this.now);
      g.gain.exponentialRampToValueAtTime(0.001, this.now + 0.025 + Math.random() * 0.04);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(this.now, Math.random() * 0.9, 0.08);
      cluster--;
      let delay;
      if (cluster <= 0) {
        cluster = Math.random() < 0.85 ? 2 + Math.floor(Math.random() * 5) : 0;
        delay = cluster > 0 ? 20 + Math.random() * 50 : 120 + Math.random() * 300;
      } else delay = 20 + Math.random() * 50;
      timer = setTimeout(drop, delay);
    };
    cluster = 3; drop();
    this._register(name, out, () => {
      alive = false; clearTimeout(timer);
      try { bed.stop(); lfo.stop(); } catch (e) {}
    }, volume);
  }

  /* ---------- 合成：茶炉沸水咕嘟（低频成簇 + 加热低鸣） ---------- */
  startBubble(name, { volume = 0.4 } = {}) {
    this.ensure();
    if (this.tracks[name]) return;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(volume, this.now + 2);
    out.connect(this.master);
    // 加热低鸣
    const bed = this.ctx.createBufferSource();
    bed.buffer = this.noiseBuffer; bed.loop = true;
    const bedLP = this.ctx.createBiquadFilter();
    bedLP.type = 'lowpass'; bedLP.frequency.value = 240;
    const bedGain = this.ctx.createGain(); bedGain.gain.value = 0.05;
    bed.connect(bedLP); bedLP.connect(bedGain); bedGain.connect(out);
    bed.start();
    // 咕嘟：低频成簇 + 正弦下滑音"啵"（液体水泡的特征是音高下滑，纯噪声不像）
    let alive = true, timer = null, cluster = 0, f = 260;
    const blip = () => {
      if (!alive) return;
      f = Math.min(400, Math.max(160, f + (Math.random() - 0.5) * 100));
      // 液体啵声：正弦从 ~2f 滑到 ~f
      const o = this.ctx.createOscillator(); o.type = 'sine';
      const f0 = f * (1.6 + Math.random() * 0.6);
      o.frequency.setValueAtTime(f0, this.now);
      o.frequency.exponentialRampToValueAtTime(Math.max(60, f0 * 0.55), this.now + 0.12);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(0.05 + Math.random() * 0.07, this.now);
      og.gain.exponentialRampToValueAtTime(0.001, this.now + 0.1 + Math.random() * 0.08);
      o.connect(og); og.connect(out);
      o.start(); o.stop(this.now + 0.25);
      // 伴随的气泡噪声
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 2.5;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.03 + Math.random() * 0.05, this.now);
      g.gain.exponentialRampToValueAtTime(0.001, this.now + 0.07 + Math.random() * 0.1);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(this.now, Math.random() * 0.8, 0.2);
      cluster--;
      let delay;
      if (cluster <= 0) {
        cluster = Math.random() < 0.7 ? 3 + Math.floor(Math.random() * 5) : 0;
        delay = cluster > 0 ? 45 + Math.random() * 70 : 250 + Math.random() * 600;
      } else delay = 45 + Math.random() * 70;
      timer = setTimeout(blip, delay);
    };
    cluster = 3; blip();
    this._register(name, out, () => {
      alive = false; clearTimeout(timer);
      try { bed.stop(); } catch (e) {}
    }, volume);
  }

  /* ---------- 合成：烛火（极轻的气流感 + 罕见微噼剥，绝不像滴答） ---------- */
  startCandle(name, { volume = 0.35 } = {}) {
    this.ensure();
    if (this.tracks[name]) return;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(volume, this.now + 2);
    out.connect(this.master);
    // 气流床：暗噪 + 1.3Hz 缓摇（火焰的缓慢起伏，而不是"沙沙"背景音）
    const bed = this.ctx.createBufferSource();
    bed.buffer = this.noiseBuffer; bed.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520;
    const bedGain = this.ctx.createGain(); bedGain.gain.value = 0.02;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 1.3;   // 缓慢摇曳，像火焰起伏而非快速燃烧
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.012;
    lfo.connect(lfoG); lfoG.connect(bedGain.gain);
    bed.connect(lp); lp.connect(bedGain); bedGain.connect(out);
    bed.start(); lfo.start();
    // 偶尔一声极轻的哔剥：间隔 1.5~5s、幅度压到很低，避免被听成钟摆
    let alive = true, timer = null;
    const snap = () => {
      if (!alive) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1600 + Math.random() * 1200; bp.Q.value = 1.5;
      const g = this.ctx.createGain();
      const amp = 0.012 + Math.random() * 0.025;
      g.gain.setValueAtTime(amp, this.now);
      g.gain.exponentialRampToValueAtTime(0.001, this.now + 0.02 + Math.random() * 0.03);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(this.now, Math.random() * 0.8, 0.06);
      timer = setTimeout(snap, 1500 + Math.random() * 3500);
    };
    snap();
    this._register(name, out, () => {
      alive = false; clearTimeout(timer);
      try { bed.stop(); lfo.stop(); } catch (e) {}
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

  /* ---------- 翻书：注册声轨 + 随机播放一页（由房间动画调度，声画同步） ---------- */
  async startPage(name, { volume = 0.45 } = {}) {
    this.ensure();
    if (this.tracks[name]) return;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(volume, this.now + 2);
    out.connect(this.master);
    this._register(name, out, () => {}, volume);
    this._pageBufs = null;
    const files = ['01', '02', '03', '04', '05'];
    Promise.all(files.map(n => this.loadBuffer('page' + n, `assets/audio/page_flip_${n}.m4a`)))
      .then(buffs => { this._pageBufs = buffs; })
      .catch(() => {});
  }

  /* 翻一页：随机挑一个样本，轻微变调，经翻书声轨的增益输出（音量滑杆统管）。
     15% 概率连翻两页（第二次轻一点、稍晚一点，更像真实读书） */
  pageFlip() {
    const t = this.tracks.page;
    if (!t || !this._pageBufs || !this._pageBufs.length) return;
    const play = (when, gainMul) => {
      const buf = this._pageBufs[Math.floor(Math.random() * this._pageBufs.length)];
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.94 + Math.random() * 0.12;
      const g = this.ctx.createGain();
      g.gain.value = (0.9 + Math.random() * 0.4) * gainMul;
      src.connect(g); g.connect(t.gain);
      src.start(when);
    };
    play(this.now, 1);
    if (Math.random() < 0.15) play(this.now + 0.35 + Math.random() * 0.2, 0.7);
  }
}

window.engine = new AudioEngine();
