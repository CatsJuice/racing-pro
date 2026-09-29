import * as THREE from 'three';
import type { Screen } from '../app';
import { CarVisual } from '../car/carVisual';
import { ASSIST_LEVELS, ASSISTS, type AssistLevel, VehiclePhysics } from '../car/physics';
import { carName, t, trackName } from '../i18n';
import { cloneSetup, type CarSetup } from '../car/setup';
import { bestLap, F, FRAME_STRIDE, fmtTime, getPrefs, type LapRecord, setPrefs, submitLap, uid } from '../core/storage';
import { fetchBoard, fetchOnlineLap, identity, submitOnline } from '../core/online';
import { toLeaderboard, toMenu, toReplay } from '../nav';
import { isOfficial } from '../track/official';
import { loadAssets } from '../render/assets';
import { Environment, hourLabel, TIME_PRESETS } from '../render/environment';
import { getStage } from '../render/toon';
import { timeControls } from '../ui/timeControls';
import { FrameRecorder, RECORD_HZ, sampleAt, timeAtDistance } from '../replay/frames';
import type { TrackData } from '../track/track';
import { TrackScene } from '../track/trackScene';
import { h } from '../ui/dom';
import { CarAudio } from './audio';
import { FallingLeaves, SkidMarks, Smoke } from './effects';
import { Hud } from './hud';
import { Input } from './input';

const CAMERA_KEYS = ['race.camChase', 'race.camFar', 'race.camHood', 'race.camHeli'] as const;
const REWIND_SECONDS = 20;

/** Everything needed to resume the session from a past moment. */
interface Snapshot {
  phys: Float64Array;
  simTime: number;
  lastS: number;
  lapActive: boolean;
  lapStart: number;
  lapNo: number;
  lapValid: boolean;
  invalidReason: string;
  sectors: (number | null)[];
  recCount: number;
  recordAcc: number;
  topSpeed: number;
  offTime: number;
  wrongWay: number;
  centreHint: number;
  wheelHints: number[];
  camYaw: number;
}

export class RaceScreen implements Screen {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 5000);
  private track!: TrackScene;
  private car!: CarVisual;
  private phys!: VehiclePhysics;
  private ghost: CarVisual | null = null;
  private ghostLap: LapRecord | null = null;
  private env!: Environment;
  private headlight: THREE.SpotLight | null = null;
  private input = new Input();
  private audio: CarAudio | null = null;
  private hud!: Hud;
  private skids = new SkidMarks();
  private smoke = new Smoke();
  private leaves = new FallingLeaves();
  private root!: HTMLElement;
  private pauseEl: HTMLElement | null = null;
  private paused = false;
  private camMode = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camYaw = 0;
  private wheelHints = [-1, -1, -1, -1];
  private centreHint = -1;
  private surfKinds: string[] = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
  private shake = 0;

  // timing
  private simTime = 0;
  private lastS = 0;
  private lapActive = false;
  private lapStart = 0;
  private lapNo = 0;
  private lapValid = true;
  private invalidReason = '';
  private sectors: (number | null)[] = [null, null, null];
  private sectorMarks: number[] = [];
  private bestSectors: (number | null)[] = [null, null, null];
  private lastLap: number | null = null;
  private bestTime: number | null = null;
  private recorder = new FrameRecorder();
  private recordAcc = 0;
  private deltaHint = 0;
  private wrongWay = 0;
  private offTime = 0;
  private brakeHeat = 0;
  private flame = 0;
  private lastGear = 1;
  private lastThrottle = 0;
  // rewind
  private history: Snapshot[] = [];
  private rewindCursor = -1;
  private rewindHold = 0;
  private rewindsThisLap = 0;
  private rewindEl: HTMLElement | null = null;
  private ghostEnabled = true;
  private assistLevel: AssistLevel = 'novice';
  private topSpeed = 0;
  private sessionLaps: { time: number; valid: boolean }[] = [];

  private official: boolean;
  private ghostKind: 'personal' | 'challenge' = 'personal';

  constructor(private trackData: TrackData, private setup: CarSetup, private opts: { ghostLapId?: string } = {}) {
    this.official = isOfficial(trackData.id);
    this.setup = cloneSetup(setup);
  }

  async mount(root: HTMLElement) {
    this.root = root;
    root.append(h('div', { class: 'loading' }, t('common.loading')));
    await loadAssets();
    root.innerHTML = '';
    const prefs = getPrefs();
    this.camMode = prefs.camera ?? 0;
    this.assistLevel = prefs.assist ?? 'novice';
    this.ghostEnabled = prefs.ghost !== false;

    this.env = new Environment(this.scene, { shadowSize: 70, hour: prefs.hour ?? 16.8 });
    this.env.speed = prefs.timeFlow ?? 0;
    getStage().post.dof = prefs.dof === false ? 0 : 1;
    getStage().post.dofStrength = 0;
    this.track = new TrackScene(this.trackData);
    this.scene.add(this.track.group);
    this.sectorMarks = [this.track.geo.length / 3, (this.track.geo.length * 2) / 3];

    this.phys = new VehiclePhysics(this.setup);
    this.phys.assist = ASSISTS[this.assistLevel];
    this.phys.surfaceFn = (x, z, i) => {
      const r = this.track.surfaceAt(x, z, this.wheelHints[i]);
      this.wheelHints[i] = r.proj.index;
      this.surfKinds[i] = r.surface.kind;
      return r.surface;
    };
    this.car = new CarVisual(this.setup);
    this.scene.add(this.car.root);
    // real headlights for the player's car at night
    const hl = new THREE.SpotLight('#fff1cf', 0, 70, 0.55, 0.65, 1.2);
    hl.position.set(0, 0.7, 2.1);
    hl.target.position.set(0, 0, 25);
    this.car.root.add(hl, hl.target);
    this.headlight = hl;
    this.scene.add(this.skids.mesh, this.smoke.mesh, this.leaves.mesh);
    this.placeOnGrid();

    this.env.collect();
    this.hud = new Hud(this.trackData);
    root.append(this.hud.el);
    root.className = 'race';

    try {
      this.audio = new CarAudio();
      this.audio.setMuted(!!prefs.muted);
    } catch {
      this.audio = null;
    }

    const best = await bestLap(this.trackData.id);
    if (best) {
      this.bestTime = best.time;
      this.bestSectors = [best.sectors[0] ?? null, best.sectors[1] ?? null, best.sectors[2] ?? null];
    }
    if (this.opts.ghostLapId) {
      try {
        this.setGhost(await fetchOnlineLap(this.opts.ghostLapId), 'challenge');
      } catch (e) {
        this.hud.message(t('race.ghostFail', { err: (e as Error).message }), 'bad');
        if (best) this.setGhost(best, 'personal');
      }
    } else if (best) this.setGhost(best, 'personal');
    if (this.official) {
      this.hud.setOnline(identity() ? t('race.globalBoard') : t('race.noNameNoUpload'));
      fetchBoard(this.trackData.id, 1).then((b) => {
        const wr = b.entries[0];
        const mine = b.me ? t('race.myRank', { rank: b.me.rank, total: b.total }) : t('race.globalBoard');
        this.hud.setOnline(wr ? t('race.record', { mine, name: wr.name, time: fmtTime(wr.time) }) : t('race.noRecord', { mine }));
      }).catch(() => this.hud.setOnline(t('race.offline')));
    }
    this.hud.message(t('race.intro', { track: trackName(this.trackData), car: carName(this.setup), assist: t(`assist.${this.assistLevel}`) }), 'info', 3);
    this.hud.setAssist(t(`assist.${this.assistLevel}`));
  }

  private setGhost(lap: LapRecord, kind: 'personal' | 'challenge') {
    this.ghostLap = lap;
    this.ghostKind = kind;
    this.deltaHint = 0;
    this.refreshGhostLabel();
    this.ghost?.dispose();
    this.ghost = new CarVisual(lap.car, { ghost: true });
    this.ghost.root.visible = false;
    this.scene.add(this.ghost.root);
  }

  private refreshGhostLabel() {
    const g = this.ghostLap;
    if (!g) return this.hud.setGhostInfo(null);
    const who = g.playerName ?? t('common.me');
    this.hud.setGhostInfo(t(this.ghostKind === 'challenge' ? 'race.challengeLabel' : 'race.ghostLabel', { who, time: fmtTime(g.time) }));
  }

  private async challengeWorldRecord() {
    try {
      const b = await fetchBoard(this.trackData.id, 1);
      const top = b.entries[0];
      if (!top) return this.hud.message(t('race.noWorldRecord'), 'info');
      this.setGhost(await fetchOnlineLap(top.lapId), 'challenge');
      this.hud.message(t('race.challenging', { name: top.name, time: fmtTime(top.time) }), 'good');
    } catch (e) {
      this.hud.message((e as Error).message, 'bad');
    }
  }

  private placeOnGrid() {
    const g = this.track.geo;
    const p = g.pointAt(-12);
    const side = g.width * 0.22;
    this.phys.reset(p.x + p.nx * side, p.z + p.nz * side, Math.atan2(p.tx, p.tz));
    this.wheelHints = [-1, -1, -1, -1];
    this.centreHint = -1;
    this.lastS = g.length - 12;
    this.lapActive = false;
    this.skids.reset();
    this.camYaw = this.phys.heading;
    this.snapCamera();
  }

  private resetToTrack() {
    const g = this.track.geo;
    const pr = g.project(this.phys.x, this.phys.z, this.centreHint);
    const p = g.pointAt(pr.s);
    this.phys.reset(p.x, p.z, Math.atan2(p.tx, p.tz));
    this.wheelHints = [pr.index, pr.index, pr.index, pr.index];
    this.skids.reset();
    if (this.lapActive) this.invalidate(t('race.reason.reset'));
    this.lastS = pr.s;
    this.camYaw = this.phys.heading;
  }

  private invalidate(reason: string) {
    if (!this.lapActive || !this.lapValid) return;
    this.lapValid = false;
    this.invalidReason = reason;
    this.hud.message(t('race.invalid', { reason }), 'bad');
  }

  // ------------------------------------------------------------------ loop
  update(dt: number, time: number) {
    if (!this.phys) return;
    if (this.input.consume('pause')) this.togglePause();
    if (this.input.consume('camera')) {
      this.camMode = (this.camMode + 1) % 4;
      setPrefs({ camera: this.camMode });
      this.hud.message(t('race.camera', { name: t(CAMERA_KEYS[this.camMode]) }), 'info', 1.2);
    }
    if (this.input.consume('ghost')) {
      this.ghostEnabled = !this.ghostEnabled;
      setPrefs({ ghost: this.ghostEnabled });
      this.hud.message(t(this.ghostEnabled ? 'race.ghostOn' : 'race.ghostOff'), 'info', 1.2);
    }
    if (this.input.consume('time')) {
      const next = TIME_PRESETS.find((t) => t.h > this.env.hour + 0.1) ?? TIME_PRESETS[0];
      this.setHour(next.h);
      this.hud.message(t('race.timeSet', { label: t(next.key), time: hourLabel(next.h) }), 'info', 1.2);
    }
    if (this.input.consume('mute') && this.audio) {
      this.audio.setMuted(!this.audio.isMuted);
      setPrefs({ muted: this.audio.isMuted });
    }

    if (!this.paused && this.input.rewinding && this.history.length > 1) {
      this.rewindStep(dt);
    } else if (!this.paused) {
      if (this.rewindCursor >= 0) this.endRewind();
      if (this.input.consume('reset')) this.resetToTrack();
      const controls = this.input.read(dt);
      const prevT = this.simTime;
      this.phys.update(dt, controls);
      this.simTime += dt;
      this.collide();
      this.timing(prevT, dt);
      this.effects(dt);
      this.pushSnapshot();
      this.audio?.update(this.phys.rpm, this.phys.throttleOut, Math.max(...this.phys.wheels.map((w) => w.combinedSlip)), this.phys.speed);
    }

    const p = this.phys;
    this.car.update({
      x: p.x, z: p.z, heading: p.heading, pitch: p.pitch, roll: p.roll, heave: p.heave,
      steer: p.steerAngle, wheelSpin: p.wheels.map((w) => w.spin), brake: p.brakeOut,
      brakeHeat: this.brakeHeat, flame: this.flame,
    });
    this.updateGhost();
    this.track.update(time);
    this.updateCamera(dt);
    this.env.update(dt, time);
    this.env.follow(p.x, p.z);
    this.track.setNight(this.env.night);
    this.leaves.update(dt, p.x, p.z);
    if (this.headlight) {
      this.headlight.intensity = this.env.night * 90;
      this.headlight.visible = this.env.night > 0.05;
    }
    this.hud.updateCar(p, dt);
    this.hud.drawMinimap(p, this.ghost?.root.visible ? { x: this.ghost.root.position.x, z: this.ghost.root.position.z } : null);
    this.render();
  }

  // ------------------------------------------------------------------ rewind (hold R / gamepad Y)
  private pushSnapshot() {
    const snap: Snapshot = {
      phys: this.phys.saveState(new Float64Array(VehiclePhysics.STATE_SIZE)),
      simTime: this.simTime,
      lastS: this.lastS,
      lapActive: this.lapActive,
      lapStart: this.lapStart,
      lapNo: this.lapNo,
      lapValid: this.lapValid,
      invalidReason: this.invalidReason,
      sectors: this.sectors.slice(),
      recCount: this.recorder.count,
      recordAcc: this.recordAcc,
      topSpeed: this.topSpeed,
      offTime: this.offTime,
      wrongWay: this.wrongWay,
      centreHint: this.centreHint,
      wheelHints: this.wheelHints.slice(),
      camYaw: this.camYaw,
    };
    this.history.push(snap);
    let drop = 0;
    while (drop < this.history.length - 1 && this.history[drop].simTime < this.simTime - REWIND_SECONDS) drop++;
    if (drop > 30) this.history.splice(0, drop);
  }

  private applySnapshot(s: Snapshot) {
    this.phys.loadState(s.phys);
    this.simTime = s.simTime;
    this.lastS = s.lastS;
    this.lapActive = s.lapActive;
    this.lapStart = s.lapStart;
    this.lapNo = s.lapNo;
    this.lapValid = s.lapValid;
    this.invalidReason = s.invalidReason;
    this.sectors = s.sectors.slice();
    this.recordAcc = s.recordAcc;
    this.topSpeed = s.topSpeed;
    this.offTime = s.offTime;
    this.wrongWay = s.wrongWay;
    this.centreHint = s.centreHint;
    this.wheelHints = s.wheelHints.slice();
    this.camYaw = s.camYaw;
  }

  private rewindStep(dt: number) {
    if (this.rewindCursor < 0) {
      this.rewindCursor = this.history.length - 1;
      this.rewindHold = 0;
      this.audio?.setMuted(true);
      document.body.classList.add('rewinding');
      this.rewindEl = h('div', { class: 'rewind-overlay' }, h('div', { class: 'rewind-badge' }, t('race.rewind'), h('small', null, '')));
      this.root.append(this.rewindEl);
    }
    // accelerates the longer the key is held (1x → 4x)
    this.rewindHold += dt;
    const speed = 1 + Math.min(3, this.rewindHold * 1.2);
    const target = this.history[this.rewindCursor].simTime - dt * speed;
    while (this.rewindCursor > 0 && this.history[this.rewindCursor].simTime > target) this.rewindCursor--;
    this.applySnapshot(this.history[this.rewindCursor]);
    const back = this.history[this.history.length - 1].simTime - this.simTime;
    const left = this.history[this.rewindCursor].simTime - this.history[0].simTime;
    const small = this.rewindEl?.querySelector('small');
    if (small) small.textContent = `-${back.toFixed(1)}s${left < 0.05 ? t('race.rewindEnd') : ''}`;
    this.refreshLapHud();
  }

  private endRewind() {
    const snap = this.history[this.rewindCursor];
    this.history.length = this.rewindCursor + 1;
    this.recorder.truncate(snap.recCount);
    this.rewindCursor = -1;
    if (this.lapActive) this.rewindsThisLap++;
    this.skids.reset();
    this.wheelHints = [-1, -1, -1, -1];
    document.body.classList.remove('rewinding');
    this.rewindEl?.remove();
    this.rewindEl = null;
    if (this.audio) this.audio.setMuted(!!getPrefs().muted);
  }

  private render() {
    // depth of field only suits the high helicopter view; driving views stay sharp
    getStage().post.dofStrength = this.camMode === 3 ? 0.6 : 0;
    getStage().render(this.scene, this.camera, this.env);
  }

  private collide() {
    const p = this.phys;
    const g = this.track.geo;
    const pr = g.project(p.x, p.z, this.centreHint);
    this.centreHint = pr.index;
    const side = pr.lateral > 0 ? 1 : -1;
    const limit = this.track.barrierOffset - 1.1;
    if (Math.abs(pr.lateral) > limit && this.track.hasBarrier(pr.index, side) && Math.abs(pr.lateral) < limit + 4) {
      const c = g.samples[pr.index];
      const nx = c.nx * side, nz = c.nz * side;
      const pen = Math.abs(pr.lateral) - limit;
      p.x -= nx * pen;
      p.z -= nz * pen;
      const vn = p.vx * nx + p.vz * nz;
      if (vn > 0) {
        p.vx -= 1.35 * vn * nx;
        p.vz -= 1.35 * vn * nz;
        p.vx *= 0.9;
        p.vz *= 0.9;
        p.yawRate *= 0.5;
        this.shake = Math.min(1, vn / 15);
        if (vn > 2) this.audio?.thump(vn / 20);
        if (vn > 6) this.hud.message(t('race.crash'), 'bad', 0.8);
      }
    }
    // world bounds
    const b = g.bounds;
    const M = 700;
    p.x = Math.max(b.minX - M, Math.min(b.maxX + M, p.x));
    p.z = Math.max(b.minZ - M, Math.min(b.maxZ + M, p.z));
  }

  private timing(prevT: number, dt: number) {
    const p = this.phys;
    const g = this.track.geo;
    const L = g.length;
    const s = g.project(p.x, p.z, this.centreHint).s;
    const prev = this.lastS;
    let ds = s - prev;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;

    // wrong way: actually travelling backwards along the track (a spin that keeps sliding forward is fine)
    const c = g.samples[this.centreHint];
    const velDot = p.speed > 0.1 ? (p.vx * c.tx + p.vz * c.tz) / p.speed : 1;
    if (velDot < -0.5 && p.speed > 4) this.wrongWay += dt;
    else this.wrongWay = 0;
    if (this.wrongWay > 1.5) {
      if (this.wrongWay < 1.5 + dt * 1.5) this.hud.message(t('race.wrongWay'), 'bad', 1.5);
      this.invalidate(t('race.reason.wrongWay'));
    }
    // shortcut detection
    if (this.lapActive && ds > 45) this.invalidate(t('race.reason.shortcut'));
    // off track: all four wheels off the tarmac/kerbs
    // (a brief graze does not count; must stay fully off for a moment)
    if (this.surfKinds.every((k) => k === 'grass')) this.offTime += dt;
    else this.offTime = 0;
    if (this.lapActive && this.offTime > 0.35) this.invalidate(t('race.reason.offTrack'));

    if (this.lapActive) {
      const lapT = this.simTime - this.lapStart;
      for (let i = 0; i < 2; i++) {
        const m = this.sectorMarks[i];
        if (this.sectors[i] == null && prev < m && s >= m && ds > 0 && ds < 50) {
          const before = i === 0 ? 0 : (this.sectors[0] ?? 0);
          this.sectors[i] = lapT - before;
        }
      }
    }

    // start/finish crossing
    const crossedFwd = prev > L - 40 && s < 40 && ds > 0;
    const crossedBack = prev < 40 && s > L - 40 && ds < 0;
    if (crossedBack) {
      if (this.lapActive) this.invalidate(t('race.reason.reverseLine'));
    }
    if (crossedFwd) {
      const frac = (L - prev) / Math.max(1e-6, L - prev + s);
      const tc = prevT + dt * frac;
      if (this.lapActive && this.sectors[0] != null && this.sectors[1] != null) this.finishLap(tc - this.lapStart);
      this.beginLap(tc);
    }
    this.lastS = s;

    // record
    if (this.lapActive) {
      this.topSpeed = Math.max(this.topSpeed, p.speed);
      this.recordAcc += dt;
      if (this.recordAcc >= 1 / RECORD_HZ) {
        this.recordAcc -= 1 / RECORD_HZ;
        this.record(this.simTime - this.lapStart, s);
      }
    }

    this.refreshLapHud();
  }

  private refreshLapHud() {
    const s = this.lastS;
    // delta vs best
    let delta: number | null = null;
    const lapT = this.lapActive ? this.simTime - this.lapStart : null;
    if (this.ghostLap && lapT != null && lapT > 0.5) {
      const r = timeAtDistance(this.ghostLap.frames, this.lapS(s), this.deltaHint);
      this.deltaHint = r.index;
      delta = lapT - r.t;
    }
    this.hud.updateLap({
      lapNo: this.lapNo,
      current: lapT,
      last: this.lastLap,
      best: this.bestTime,
      delta,
      valid: this.lapValid,
      sectors: this.sectors,
      bestSectors: this.bestSectors,
      status: this.invalidReason,
    });
  }

  /** lap-relative distance, handling the first few metres after the line */
  private lapS(s: number) {
    const L = this.track.geo.length;
    const t = this.simTime - this.lapStart;
    return t < 5 && s > L / 2 ? s - L : s;
  }

  private record(t: number, s: number) {
    const p = this.phys;
    const v = new Array(FRAME_STRIDE).fill(0);
    v[F.t] = t;
    v[F.x] = p.x;
    v[F.z] = p.z;
    v[F.heading] = p.heading;
    v[F.pitch] = p.pitch;
    v[F.roll] = p.roll;
    v[F.heave] = p.heave;
    v[F.speed] = p.speed;
    v[F.steer] = p.steerAngle;
    v[F.throttle] = p.throttleOut;
    v[F.brake] = p.brakeOut;
    v[F.s] = this.lapS(s);
    v[F.gear] = p.gear;
    v[F.rpm] = p.rpm;
    this.recorder.push(v);
  }

  private beginLap(t: number) {
    this.lapActive = true;
    this.lapStart = t;
    this.lapNo++;
    this.lapValid = true;
    this.invalidReason = '';
    this.sectors = [null, null, null];
    this.recorder.clear();
    this.recordAcc = 0;
    // rewinding cannot cross the line backwards into a lap that was already scored
    this.history = [];
    this.rewindsThisLap = 0;
    this.deltaHint = 0;
    this.topSpeed = 0;
    this.record(this.simTime - t, this.track.geo.project(this.phys.x, this.phys.z, this.centreHint).s);
  }

  private finishLap(time: number) {
    const L = this.track.geo.length;
    this.sectors[2] = time - (this.sectors[0] ?? 0) - (this.sectors[1] ?? 0);
    // final frame exactly on the line
    this.record(time, L);
    const frames = this.recorder.toArray();
    // clamp final frame's time
    frames[frames.length - FRAME_STRIDE + F.t] = time;
    this.lastLap = time;
    this.sessionLaps.push({ time, valid: this.lapValid });
    if (!this.lapValid) {
      this.hud.message(t('race.lapInvalid', { time: fmtTime(time), reason: this.invalidReason }), 'bad', 3);
      return;
    }
    const lap: LapRecord = {
      id: uid('lap-'),
      trackId: this.trackData.id,
      trackName: this.trackData.name,
      carId: this.setup.id,
      carName: this.setup.name,
      car: cloneSetup(this.setup),
      time,
      sectors: this.sectors.map((x) => x ?? 0),
      date: Date.now(),
      frames,
      topSpeed: this.topSpeed * 3.6,
      assist: this.assistLevel,
      rewinds: this.rewindsThisLap,
    };
    const prevBest = this.bestTime;
    const personalBest = prevBest == null || time < prevBest;
    if (personalBest) this.bestTime = time;
    submitLap(lap).then((rank) => {
      if (personalBest) {
        this.hud.message(t('race.pb', { time: fmtTime(time) }), 'good', 3.5);
        if (this.ghostKind === 'personal') this.setGhost(lap, 'personal');
      } else if (!this.official) {
        this.hud.message(rank > 0 ? t('race.lapLocalRank', { time: fmtTime(time), rank }) : t('race.lap', { time: fmtTime(time) }), rank > 0 ? 'good' : 'info', 3);
      }
    });
    if (this.official) {
      if (!identity()) {
        this.hud.message(t('race.lapNeedName', { time: fmtTime(time) }), 'info', 3);
      } else {
        submitOnline(lap).then((r) => {
          this.hud.setOnline(t('race.globalRank', { rank: r.rank }));
          if (r.improved) this.hud.message(r.rank === 1 ? t('race.worldRecord', { time: fmtTime(time) }) : t('race.globalPlace', { rank: r.rank, time: fmtTime(time) }), 'good', 4);
          else if (!personalBest) this.hud.message(t('race.globalBestStill', { time: fmtTime(time), best: fmtTime(r.best) }), 'info', 3);
        }).catch((e) => this.hud.message(t('race.uploadFail', { err: (e as Error).message }), 'bad', 3));
      }
    }
    // track best sectors
    this.sectors.forEach((s, i) => {
      if (s != null && (this.bestSectors[i] == null || s < (this.bestSectors[i] as number))) this.bestSectors[i] = s;
    });
  }

  private ghostFrame = new Float32Array(FRAME_STRIDE);
  private updateGhost() {
    if (!this.ghost || !this.ghostLap) return;
    const t = this.simTime - this.lapStart;
    const show = this.ghostEnabled && this.lapActive && t <= this.ghostLap.time;
    this.ghost.root.visible = show;
    if (!show) return;
    const f = sampleAt(this.ghostLap.frames, t, this.ghostFrame);
    // hide the ghost while it overlaps the player's car
    if (Math.hypot(f[F.x] - this.phys.x, f[F.z] - this.phys.z) < 3.2) { this.ghost.root.visible = false; return; }
    const spin = (f[F.s] / 0.32);
    this.ghost.update({
      x: f[F.x], z: f[F.z], heading: f[F.heading], pitch: f[F.pitch], roll: f[F.roll], heave: f[F.heave],
      steer: f[F.steer], wheelSpin: [spin, spin, spin, spin], brake: f[F.brake],
    });
  }

  private effects(dt: number) {
    const p = this.phys;
    for (let i = 0; i < 4; i++) {
      const w = p.wheels[i];
      const off = this.surfKinds[i] === 'grass';
      const slide = w.combinedSlip > 1.05 && w.load > 400 && p.speed > 2;
      const intensity = off ? (p.speed > 3 ? 0.4 : 0) : slide ? Math.min(1, (w.combinedSlip - 1) * 1.5) : 0;
      this.skids.add(i, w.worldX, w.worldZ, intensity, off);
      if ((slide && w.combinedSlip > 1.25 && !off) || (off && p.speed > 6)) {
        if (Math.random() < (off ? 0.35 : 0.6)) this.smoke.emit(w.worldX, w.worldZ, p.vx, p.vz, off);
      }
    }
    this.smoke.update(dt);
    // brake discs heat up with braking power and cool down with airflow
    this.brakeHeat = Math.min(1, Math.max(0, this.brakeHeat + (p.brakeOut * p.speed * 0.012 - (0.08 + p.speed * 0.004) * this.brakeHeat) * dt * 3));
    // exhaust pops: upshifts and lifting off at high revs
    this.flame = Math.max(0, this.flame - dt * 6);
    if (p.gear > this.lastGear && p.gear > 1) this.flame = 1;
    if (this.lastThrottle > 0.8 && p.throttleOut < 0.2 && p.rpm > p.setup.redline * 0.65) this.flame = 0.8;
    if (p.throttleOut < 0.1 && p.rpm > p.setup.redline * 0.6 && Math.random() < dt * 4) this.flame = Math.max(this.flame, 0.5);
    this.lastGear = p.gear;
    this.lastThrottle = p.throttleOut;
    this.shake = Math.max(0, this.shake - dt * 3);
  }

  private snapCamera() {
    this.updateCamera(1, true);
  }

  private updateCamera(dt: number, snap = false) {
    const p = this.phys;
    const cam = this.camera;
    // camera yaw lags behind the car heading (shows drift angle)
    let d = p.heading - this.camYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.camYaw += d * (snap ? 1 : Math.min(1, dt * 4.5));
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const speed = p.speed;
    let back = 6.8, up = 2.5, lookAhead = 4, lookUp = 1.0;
    if (this.camMode === 1) { back = 11; up = 4; lookAhead = 6; }
    if (this.camMode === 3) { back = 22; up = 16; lookAhead = 8; lookUp = 0; }
    let target: THREE.Vector3, look: THREE.Vector3;
    if (this.camMode === 2) {
      const hf = Math.sin(p.heading), hz = Math.cos(p.heading);
      target = new THREE.Vector3(p.x + hf * 0.4, 1.28 - p.heave * 2, p.z + hz * 0.4);
      look = new THREE.Vector3(p.x + hf * 20, 1.0, p.z + hz * 20);
      this.camPos.copy(target);
      this.camLook.copy(look);
    } else {
      back += Math.min(2.5, speed * 0.03);
      target = new THREE.Vector3(p.x - fx * back, up, p.z - fz * back);
      look = new THREE.Vector3(p.x + fx * lookAhead, lookUp, p.z + fz * lookAhead);
      const k = snap ? 1 : Math.min(1, dt * 8);
      this.camPos.lerp(target, k);
      this.camLook.lerp(look, snap ? 1 : Math.min(1, dt * 12));
    }
    cam.position.copy(this.camPos);
    if (this.shake > 0) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake * 0.4, (Math.random() - 0.5) * this.shake * 0.3, 0));
    cam.lookAt(this.camLook);
    const fov = 60 + Math.min(20, speed * 0.22);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
  }

  private setHour(h: number) {
    this.env.setHour(h);
    setPrefs({ hour: this.env.hour });
  }

  private setAssist(l: AssistLevel) {
    if (l === this.assistLevel) return;
    this.assistLevel = l;
    this.phys.assist = ASSISTS[l];
    setPrefs({ assist: l });
    this.hud.setAssist(t(`assist.${l}`));
    // changing aids mid-lap would mix two categories on the leaderboard
    this.invalidate(t('race.reason.assist'));
  }

  private togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.audio?.setMuted(true);
      const laps = this.sessionLaps.slice(-8).reverse();
      this.pauseEl = h('div', { class: 'modal-wrap' },
        h('div', { class: 'modal panel pause' },
          h('h2', null, t('pause.title')),
          timeControls(this.env),
          h('div', { class: 'col' },
            h('button', { class: 'btn primary', onclick: () => this.togglePause() }, t('pause.resume')),
            h('button', { class: 'btn', onclick: () => { this.togglePause(); this.resetToTrack(); } }, t('pause.reset')),
            h('button', { class: 'btn', onclick: () => { this.togglePause(); this.placeOnGrid(); } }, t('pause.grid')),
            h('div', { class: 'seg assist-seg' }, ASSIST_LEVELS.map((l) => h('button', {
              class: `seg-btn ${l === this.assistLevel ? 'on' : ''}`,
              onclick: (e: Event) => {
                this.setAssist(l);
                (e.currentTarget as HTMLElement).parentElement!.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on'));
                (e.currentTarget as HTMLElement).classList.add('on');
              },
            }, t('pause.assist', { level: t(`assist.${l}`) })))),
            h('button', { class: 'btn', onclick: () => toLeaderboard(this.trackData.id) }, t('pause.board')),
            this.official ? h('button', { class: 'btn', onclick: () => { this.togglePause(); this.challengeWorldRecord(); } }, t('pause.challengeWr')) : null,
            this.ghostLap ? h('button', { class: 'btn', onclick: () => toReplay(this.ghostLap!.id, undefined, this.ghostLap!.online) }, t('pause.replayGhost')) : null,
            h('button', { class: 'btn ghost', onclick: () => toMenu() }, t('pause.quit')),
          ),
          laps.length ? h('div', { class: 'session' },
            h('h3', null, t('pause.session')),
            laps.map((l) => h('div', { class: `row between ${l.valid ? '' : 'dim'}` }, h('span', { class: 'mono' }, fmtTime(l.time)), h('span', null, l.valid ? '' : t('pause.invalid')))),
          ) : null,
        ),
      );
      this.root.append(this.pauseEl);
    } else {
      this.pauseEl?.remove();
      this.pauseEl = null;
      if (this.audio) this.audio.setMuted(!!getPrefs().muted);
    }
  }

  unmount() {
    document.body.classList.remove('rewinding');
    this.input.dispose();
    this.audio?.dispose();
    this.track?.dispose();
    this.car?.dispose();
    this.ghost?.dispose();
    this.scene.clear();
  }
}
