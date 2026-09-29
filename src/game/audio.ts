/** Tiny synthesized engine / tire / wind audio. */
export class CarAudio {
  private ctx: AudioContext;
  private master: GainNode;
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private engineGain: GainNode;
  private filter: BiquadFilterNode;
  private squealGain: GainNode;
  private squealFilter: BiquadFilterNode;
  private windGain: GainNode;
  private muted = false;

  constructor() {
    const ctx = (this.ctx = new AudioContext());
    // mobile browsers start the context suspended until a user gesture
    window.addEventListener('pointerdown', this.unlock, true);
    window.addEventListener('keydown', this.unlock, true);
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 3;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'square';
    const gB = ctx.createGain();
    gB.gain.value = 0.35;
    this.oscA.connect(this.filter);
    this.oscB.connect(gB).connect(this.filter);
    this.filter.connect(this.engineGain).connect(this.master);
    this.oscA.start();
    this.oscB.start();

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mkNoise = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.start();
      return s;
    };
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 1400;
    this.squealFilter.Q.value = 12;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    mkNoise().connect(this.squealFilter).connect(this.squealGain).connect(this.master);

    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    mkNoise().connect(wf).connect(this.windGain).connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  get isMuted() {
    return this.muted;
  }

  update(rpm: number, throttle: number, slip: number, speed: number) {
    const t = this.ctx.currentTime;
    const f = Math.max(20, (rpm / 60) * 3);
    this.oscA.frequency.setTargetAtTime(f, t, 0.02);
    this.oscB.frequency.setTargetAtTime(f * 0.5, t, 0.02);
    this.filter.frequency.setTargetAtTime(500 + throttle * 1800 + rpm * 0.08, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.05 + throttle * 0.1, t, 0.05);
    const sq = Math.max(0, Math.min(1, (slip - 1.0) * 1.5)) * Math.min(1, speed / 6);
    this.squealGain.gain.setTargetAtTime(sq * 0.12, t, 0.05);
    this.squealFilter.frequency.setTargetAtTime(1100 + sq * 600, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.25, speed * speed * 0.00006), t, 0.1);
  }

  thump(strength: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 70;
    g.gain.value = Math.min(0.6, strength);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 0.3);
  }

  private unlock = () => {
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  };

  dispose() {
    window.removeEventListener('pointerdown', this.unlock, true);
    window.removeEventListener('keydown', this.unlock, true);
    this.ctx.close();
  }
}
