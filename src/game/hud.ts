import { t } from '../i18n';
import { fmtDelta, fmtTime } from '../core/storage';
import { drawCircuit, fitView, type View2D } from '../track/draw2d';
import { splinePolyline, type TrackData } from '../track/track';
import { h } from '../ui/dom';
import type { VehiclePhysics } from '../car/physics';

export interface HudLapInfo {
  lapNo: number;
  current: number | null;
  last: number | null;
  best: number | null;
  delta: number | null;
  valid: boolean;
  sectors: (number | null)[];
  bestSectors: (number | null)[];
  status: string;
}

export class Hud {
  el: HTMLElement;
  private lapTime = h('div', { class: 'hud-laptime mono' }, '--:--.---');
  private lapLabel = h('div', { class: 'hud-lapno' }, t('hud.outLap'));
  private deltaEl = h('div', { class: 'hud-delta mono' });
  private lastEl = h('span', { class: 'mono' }, '--');
  private bestEl = h('span', { class: 'mono' }, '--');
  private validEl = h('div', { class: 'hud-badge' });
  private sectorEls = [0, 1, 2].map((i) => h('div', { class: 'sector' }, `S${i + 1}`));
  private speedEl = h('div', { class: 'hud-speed' }, '0');
  private gearEl = h('div', { class: 'hud-gear' }, 'N');
  private tach = h('div', { class: 'tach' });
  private tachFill!: SVGPathElement;
  private redline = 0;
  private absEl = h('div', { class: 'assist' }, 'ABS');
  private tcsEl = h('div', { class: 'assist' }, 'TCS');
  private assistEl = h('div', { class: 'assist level' });
  private ghostEl = h('div', { class: 'hud-ghost' });
  private onlineEl = h('div', { class: 'hud-online' });
  private tires = [0, 1, 2, 3].map(() => h('div', { class: 'tire' }, h('div', { class: 'tire-load' })));
  private thrBar = h('div', { class: 'pedal-fill thr' });
  private brkBar = h('div', { class: 'pedal-fill brk' });
  private steerDot = h('div', { class: 'steer-dot' });
  private msgEl = h('div', { class: 'hud-msg' });
  private minimap = h('canvas', { class: 'minimap' });
  private mmBase: HTMLCanvasElement;
  private mmView: View2D;
  private msgTimer = 0;

  constructor(track: TrackData) {
    const size = 200;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.minimap.width = size * dpr;
    this.minimap.height = size * dpr;
    this.mmBase = document.createElement('canvas');
    this.mmBase.width = size * dpr;
    this.mmBase.height = size * dpr;
    const bctx = this.mmBase.getContext('2d')!;
    bctx.scale(dpr, dpr);
    this.mmView = fitView(splinePolyline(track.points, 8), size, size, 20);
    drawCircuit(bctx, track, this.mmView, 3.2);

    this.el = h('div', { class: 'hud' },
      h('div', { class: 'hud-tl panel' },
        h('div', { class: 'row between' }, this.lapLabel, this.validEl),
        this.lapTime,
        this.deltaEl,
        h('div', { class: 'hud-sectors' }, this.sectorEls),
        h('div', { class: 'hud-rows' },
          h('div', null, h('label', null, t('hud.last')), this.lastEl),
          h('div', null, h('label', null, t('hud.best')), this.bestEl),
        ),
        this.ghostEl,
        this.onlineEl,
      ),
      h('div', { class: 'hud-tr' }, this.minimap),
      h('div', { class: 'hud-br' },
        this.tach,
        h('div', { class: 'row assists' }, this.absEl, this.tcsEl, this.assistEl),
      ),
      h('div', { class: 'hud-bl panel' },
        h('div', { class: 'tires' }, this.tires),
        h('div', { class: 'pedals' },
          h('div', { class: 'pedal' }, this.brkBar),
          h('div', { class: 'pedal' }, this.thrBar),
        ),
        h('div', { class: 'steer-bar' }, this.steerDot),
      ),
      this.msgEl,
      h('div', { class: 'hud-help' }, t('hud.help')),
    );
  }

  /**
   * Builds the 270° tachometer for a given rev limit: a track arc, a red zone over the last
   * 12% and numbered ticks every 1000 rpm; `tachFill` is driven by stroke-dashoffset.
   */
  private buildTach(redline: number) {
    this.redline = redline;
    const S = 210, C = S / 2, R = 88, A0 = 135, SWEEP = 270;
    const pt = (k: number, r = R) => {
      const a = ((A0 + SWEEP * k) * Math.PI) / 180;
      return [C + r * Math.cos(a), C + r * Math.sin(a)];
    };
    const arc = (k0: number, k1: number, r = R) => {
      const [x0, y0] = pt(k0, r), [x1, y1] = pt(k1, r);
      return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${SWEEP * (k1 - k0) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    const maxK = Math.ceil(redline / 1000);
    const scale = (rpm: number) => rpm / (maxK * 1000);
    let ticks = '';
    for (let i = 0; i <= maxK * 2; i++) {
      const rpm = i * 500, k = scale(rpm), major = i % 2 === 0;
      const [x0, y0] = pt(k, R - 10), [x1, y1] = pt(k, R - (major ? 18 : 14));
      ticks += `<line class="tach-tick ${major ? 'major' : ''}" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke-width="${major ? 2 : 1.2}" stroke-linecap="round"/>`;
      if (major) {
        const [tx, ty] = pt(k, R - 30);
        ticks += `<text class="tach-num" x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central">${i / 2}</text>`;
      }
    }
    const red0 = scale(redline * 0.88), red1 = scale(redline);
    this.tach.innerHTML = `<div class="tach-bg"></div>
      <svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
        <defs><linearGradient id="tachGrad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#2fd27a"/><stop offset="0.55" stop-color="#ffd23f"/><stop offset="1" stop-color="#ff6a3d"/>
        </linearGradient></defs>
        <path class="tach-track" d="${arc(0, 1)}" fill="none" stroke-width="7" stroke-linecap="round"/>
        <path class="tach-red" d="${arc(red0, red1, R + 7)}" fill="none" stroke-width="3" stroke-linecap="round"/>
        <path class="tach-fill" d="${arc(0, 1)}" fill="none" stroke-width="7" stroke-linecap="round" pathLength="100" stroke-dasharray="100 200" stroke-dashoffset="100"/>
        ${ticks}
      </svg>`;
    this.tachFill = this.tach.querySelector('.tach-fill')!;
    this.tachScale = 1 / (maxK * 1000);
    this.tach.append(
      h('div', { class: 'tach-center' }, this.speedEl, h('div', { class: 'unit' }, 'km/h')),
      h('div', { class: 'gear-wrap' }, this.gearEl),
    );
  }

  private tachScale = 1 / 8000;

  setGhostInfo(text: string | null) {
    this.ghostEl.textContent = text ?? '';
  }

  setOnline(text: string) {
    this.onlineEl.textContent = text;
  }

  setAssist(label: string) {
    this.assistEl.textContent = t('hud.assist', { label });
  }

  message(text: string, kind: 'info' | 'good' | 'bad' = 'info', seconds = 2.5) {
    this.msgEl.textContent = text;
    this.msgEl.className = `hud-msg show ${kind}`;
    this.msgTimer = seconds;
  }

  updateCar(p: VehiclePhysics, dt: number) {
    this.speedEl.textContent = String(Math.round(Math.abs(p.vLong) * 3.6));
    this.gearEl.textContent = p.shiftTimer > 0 ? '·' : p.gearLabel;
    const s = p.setup;
    if (s.redline !== this.redline) this.buildTach(s.redline);
    const k = Math.min(1, p.rpm / s.redline);
    const fill = Math.min(1, p.rpm * this.tachScale) * 100;
    this.tachFill.setAttribute('stroke-dashoffset', (100 - fill).toFixed(2));
    this.tach.classList.toggle('shift', k > 0.93 && p.gear > 0);
    this.absEl.classList.toggle('on', p.absActive);
    this.tcsEl.classList.toggle('on', p.tcsActive);
    const order = [0, 1, 2, 3];
    const nominal = (s.mass * 9.81) / 4;
    order.forEach((i, idx) => {
      const w = p.wheels[i];
      const el = this.tires[idx];
      // left wheels are on the left of the widget
      const slip = w.combinedSlip;
      const col = slip < 0.7 ? '#43c46b' : slip < 1.0 ? '#b7d84a' : slip < 1.3 ? '#ffc53d' : '#ff4b4b';
      el.style.background = col;
      (el.firstChild as HTMLElement).style.height = `${Math.min(100, (w.load / nominal) * 50)}%`;
      el.title = t('hud.tire', { load: w.load.toFixed(0), slip: slip.toFixed(2) });
    });
    this.thrBar.style.height = `${p.throttleOut * 100}%`;
    this.brkBar.style.height = `${p.brakeOut * 100}%`;
    this.steerDot.style.left = `${50 - p.steerPos * 46}%`;
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msgEl.classList.remove('show');
    }
  }

  updateLap(l: HudLapInfo) {
    this.lapLabel.textContent = l.current == null ? t('hud.outLapHint') : t('hud.lapNo', { n: l.lapNo });
    this.lapTime.textContent = l.current == null ? '--:--.---' : fmtTime(l.current);
    this.lastEl.textContent = fmtTime(l.last);
    this.bestEl.textContent = fmtTime(l.best);
    if (l.delta != null && l.current != null) {
      this.deltaEl.textContent = fmtDelta(l.delta);
      this.deltaEl.className = `hud-delta mono ${l.delta <= 0 ? 'good' : 'bad'}`;
    } else {
      this.deltaEl.textContent = '';
    }
    this.validEl.textContent = l.current == null ? '' : l.valid ? t('hud.valid') : t('hud.invalid');
    this.validEl.className = `hud-badge ${l.current == null ? '' : l.valid ? 'ok' : 'bad'}`;
    l.sectors.forEach((t, i) => {
      const el = this.sectorEls[i];
      const best = l.bestSectors[i];
      el.textContent = t == null ? `S${i + 1}` : t.toFixed(2);
      el.className = `sector ${t == null ? '' : best != null && t <= best + 1e-4 ? 'purple' : 'done'}`;
    });
  }

  drawMinimap(car: { x: number; z: number; heading: number }, ghost?: { x: number; z: number } | null) {
    const ctx = this.minimap.getContext('2d')!;
    const dpr = this.minimap.width / 200;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.minimap.width, this.minimap.height);
    ctx.drawImage(this.mmBase, 0, 0);
    ctx.scale(dpr, dpr);
    if (ghost) {
      const [gx, gy] = this.mmView.toScreen(ghost.x, ghost.z);
      ctx.fillStyle = '#62d6ff';
      ctx.strokeStyle = 'rgba(6,10,26,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx, gy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const [x, y] = this.mmView.toScreen(car.x, car.z);
    ctx.save();
    ctx.translate(x, y);
    // soft halo so the player never gets lost on the line
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
    halo.addColorStop(0, 'rgba(255, 90, 90, 0.55)');
    halo.addColorStop(1, 'rgba(255, 90, 90, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(-16, -16, 32, 32);
    ctx.rotate(Math.atan2(Math.cos(car.heading), Math.sin(car.heading)));
    ctx.fillStyle = '#ff4d63';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(8.5, 0);
    ctx.lineTo(-5.5, 6);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-5.5, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
