import { fmtDelta, fmtTime } from '../core/storage';
import { drawTrack, fitView, type View2D } from '../track/draw2d';
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
  private lapLabel = h('div', { class: 'hud-lapno' }, '出场圈');
  private deltaEl = h('div', { class: 'hud-delta mono' });
  private lastEl = h('span', { class: 'mono' }, '--');
  private bestEl = h('span', { class: 'mono' }, '--');
  private validEl = h('div', { class: 'hud-badge' });
  private sectorEls = [0, 1, 2].map((i) => h('div', { class: 'sector' }, `S${i + 1}`));
  private speedEl = h('div', { class: 'hud-speed mono' }, '0');
  private gearEl = h('div', { class: 'hud-gear' }, 'N');
  private rpmFill = h('div', { class: 'rpm-fill' });
  private rpmText = h('div', { class: 'rpm-text mono' });
  private shiftLight = h('div', { class: 'shift-light' });
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
    this.mmView = fitView(splinePolyline(track.points, 8), size, size, 14);
    drawTrack(bctx, track, this.mmView, { minWidthPx: 5, roadColor: '#f4f4f4', edgeColor: 'rgba(20,22,35,0.8)' });

    this.el = h('div', { class: 'hud' },
      h('div', { class: 'hud-tl panel' },
        h('div', { class: 'row between' }, this.lapLabel, this.validEl),
        this.lapTime,
        this.deltaEl,
        h('div', { class: 'hud-sectors' }, this.sectorEls),
        h('div', { class: 'hud-rows' },
          h('div', null, h('label', null, '上一圈'), this.lastEl),
          h('div', null, h('label', null, '最佳'), this.bestEl),
        ),
        this.ghostEl,
        this.onlineEl,
      ),
      h('div', { class: 'hud-tr' }, this.minimap),
      h('div', { class: 'hud-br panel' },
        h('div', { class: 'row' },
          h('div', { class: 'speed-wrap' }, this.speedEl, h('div', { class: 'unit' }, 'km/h')),
          h('div', { class: 'gear-wrap' }, this.shiftLight, this.gearEl),
        ),
        h('div', { class: 'rpm-bar' }, this.rpmFill, this.rpmText),
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
      h('div', { class: 'hud-help' }, 'W/S 油门刹车 · A/D 转向 · 空格 手刹 · Q/E 换挡 · 按住 R 时间回退 · Backspace 复位 · C 视角 · G 幽灵车 · M 静音 · T 时间 · Esc 暂停'),
    );
  }

  setGhostInfo(text: string | null) {
    this.ghostEl.textContent = text ?? '';
  }

  setOnline(text: string) {
    this.onlineEl.textContent = text;
  }

  setAssist(label: string) {
    this.assistEl.textContent = `辅助 ${label}`;
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
    const k = Math.min(1, p.rpm / s.redline);
    this.rpmFill.style.width = `${k * 100}%`;
    this.rpmFill.classList.toggle('hot', k > 0.9);
    this.rpmText.textContent = `${Math.round(p.rpm)} rpm`;
    this.shiftLight.classList.toggle('on', k > 0.93 && p.gear > 0);
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
      el.title = `载荷 ${w.load.toFixed(0)}N 滑移 ${slip.toFixed(2)}`;
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
    this.lapLabel.textContent = l.current == null ? '出场圈 · 越过起跑线开始计时' : `第 ${l.lapNo} 圈`;
    this.lapTime.textContent = l.current == null ? '--:--.---' : fmtTime(l.current);
    this.lastEl.textContent = fmtTime(l.last);
    this.bestEl.textContent = fmtTime(l.best);
    if (l.delta != null && l.current != null) {
      this.deltaEl.textContent = fmtDelta(l.delta);
      this.deltaEl.className = `hud-delta mono ${l.delta <= 0 ? 'good' : 'bad'}`;
    } else {
      this.deltaEl.textContent = '';
    }
    this.validEl.textContent = l.current == null ? '' : l.valid ? '有效' : '无效';
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
      ctx.fillStyle = '#7fd8ff';
      ctx.beginPath();
      ctx.arc(gx, gy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const [x, y] = this.mmView.toScreen(car.x, car.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(Math.cos(car.heading), Math.sin(car.heading)));
    ctx.fillStyle = '#ff3b3b';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
