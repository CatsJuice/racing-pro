export type Drivetrain = 'FWD' | 'RWD' | 'AWD';
export type DiffType = 'open' | 'lsd' | 'locked';

export interface CarSetup {
  id: string;
  name: string;
  builtin?: boolean;
  color: string;
  accent: string;

  // engine
  maxTorque: number; // Nm
  peakTorqueRpm: number;
  redline: number;
  idleRpm: number;
  engineInertia: number; // kg m^2
  engineBraking: number; // 0..1

  // gearbox
  gearCount: number;
  firstGear: number;
  topGear: number;
  finalDrive: number;
  shiftTime: number; // s
  autoShift: boolean;

  // drivetrain
  drivetrain: Drivetrain;
  awdFrontSplit: number; // 0..1 torque to front
  diffType: DiffType;
  lsdPreload: number; // Nm
  lsdLock: number; // 0..1

  // chassis
  mass: number; // kg
  frontWeight: number; // 0..1
  cogHeight: number; // m (at 100mm ride height)
  wheelbase: number; // m
  trackWidth: number; // m

  // suspension
  springF: number; // N/mm
  springR: number;
  bumpF: number; // kN s/m
  bumpR: number;
  reboundF: number;
  reboundR: number;
  arbF: number; // N/mm
  arbR: number;
  rideHeightF: number; // mm
  rideHeightR: number;
  travel: number; // mm of bump travel

  // alignment
  camberF: number; // deg (negative = top inward)
  camberR: number;
  toeF: number; // deg (positive = toe-in)
  toeR: number;
  caster: number; // deg

  // tires
  tireGrip: number; // friction coefficient
  tireWidthF: number; // mm
  tireWidthR: number;
  tirePressure: number; // psi
  tireFalloff: number; // 0..1 how much grip is lost past the peak

  // brakes
  brakeTorque: number; // Nm total at full pedal
  brakeBias: number; // front share 0..1
  abs: boolean;
  handbrakeTorque: number;

  // aero
  downforceF: number; // ClA front
  downforceR: number; // ClA rear
  dragCd: number;

  // steering
  steerLock: number; // deg
  steerSpeed: number; // lock-to-lock per second
  steerSensitivity: number; // speed sensitive reduction 0..1
  ackermann: number; // 0..1

  // assists
  tcs: boolean;
  stability: number; // 0..1 yaw damping assist
}

export type NumKey = { [K in keyof CarSetup]: CarSetup[K] extends number ? K : never }[keyof CarSetup];

export interface ParamMeta {
  key: keyof CarSetup;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  kind?: 'number' | 'bool' | 'select' | 'color' | 'text';
  options?: { value: string; label: string }[];
  desc: string;
}

export interface ParamGroup {
  id: string;
  label: string;
  icon: string;
  params: ParamMeta[];
}

export const PARAM_GROUPS: ParamGroup[] = [
  {
    id: 'look', label: '外观', icon: '🎨', params: [
      { key: 'name', label: '名称', kind: 'text', desc: '赛车名称' },
      { key: 'color', label: '车身颜色', kind: 'color', desc: '主色调' },
      { key: 'accent', label: '条纹颜色', kind: 'color', desc: '赛车条纹 / 尾翼线条颜色' },
    ],
  },
  {
    id: 'engine', label: '引擎', icon: '🔥', params: [
      { key: 'maxTorque', label: '最大扭矩', unit: 'Nm', min: 120, max: 900, step: 10, desc: '决定加速力量。扭矩越大加速越猛，但更容易打滑。' },
      { key: 'peakTorqueRpm', label: '峰值扭矩转速', unit: 'rpm', min: 2000, max: 8000, step: 100, desc: '扭矩曲线的峰值位置。低转速峰值 = 低速有劲；高转速峰值 = 高转尖峰。' },
      { key: 'redline', label: '红线转速', unit: 'rpm', min: 5000, max: 10000, step: 100, desc: '断油转速。越高每个挡位能拉得越长。' },
      { key: 'idleRpm', label: '怠速', unit: 'rpm', min: 600, max: 1500, step: 50, desc: '起步离合接合的基础转速。' },
      { key: 'engineInertia', label: '飞轮惯量', unit: 'kg·m²', min: 0.05, max: 0.5, step: 0.01, desc: '惯量小 = 转速变化快、低挡加速更灵敏；惯量大 = 更平顺、更难打滑。' },
      { key: 'engineBraking', label: '引擎制动', min: 0, max: 1, step: 0.05, desc: '松油门时的拖拽力度，影响松油时的重心前移和收油转向。' },
    ],
  },
  {
    id: 'gearbox', label: '变速箱', icon: '⚙️', params: [
      { key: 'gearCount', label: '挡位数', min: 4, max: 8, step: 1, desc: '挡位越多，各挡齿比越密，转速更容易保持在功率区。' },
      { key: 'firstGear', label: '一挡齿比', min: 2.2, max: 4.5, step: 0.05, desc: '越大起步越猛，但一挡很快就到红线。' },
      { key: 'topGear', label: '顶挡齿比', min: 0.6, max: 1.4, step: 0.02, desc: '越小极速越高（前提是马力够），越大顶挡加速越好。' },
      { key: 'finalDrive', label: '主减速比', min: 2.5, max: 5.5, step: 0.05, desc: '整体缩放所有挡位。大 = 加速好极速低；小 = 反之。' },
      { key: 'shiftTime', label: '换挡时间', unit: 's', min: 0.03, max: 0.6, step: 0.01, desc: '换挡期间动力中断的时间。' },
      { key: 'autoShift', label: '自动换挡', kind: 'bool', desc: '关闭后使用 Q / E（或 Shift / Ctrl）手动换挡。' },
    ],
  },
  {
    id: 'drive', label: '传动', icon: '🔧', params: [
      {
        key: 'drivetrain', label: '驱动方式', kind: 'select', desc: 'FWD 稳定易推头；RWD 灵活可甩尾；AWD 出弯牵引最强。', options: [
          { value: 'FWD', label: '前驱 FWD' }, { value: 'RWD', label: '后驱 RWD' }, { value: 'AWD', label: '四驱 AWD' },
        ],
      },
      { key: 'awdFrontSplit', label: '四驱前轴扭矩', unit: '%', min: 0.1, max: 0.9, step: 0.05, desc: '仅四驱有效。偏前 = 更稳更推头，偏后 = 更像后驱。' },
      {
        key: 'diffType', label: '差速器', kind: 'select', desc: '开放式：内侧轮容易空转；限滑：兼顾；锁止：牵引最好但转向不足、容易甩尾。', options: [
          { value: 'open', label: '开放式' }, { value: 'lsd', label: '限滑 LSD' }, { value: 'locked', label: '锁止' },
        ],
      },
      { key: 'lsdPreload', label: 'LSD 预载', unit: 'Nm', min: 0, max: 400, step: 10, desc: '即使不给油也存在的锁止力，增加稳定性但降低入弯灵活性。' },
      { key: 'lsdLock', label: 'LSD 锁止率', unit: '%', min: 0, max: 1, step: 0.05, desc: '随扭矩增加的锁止比例。越高出弯牵引越好，油门转向越明显。' },
    ],
  },
  {
    id: 'chassis', label: '底盘', icon: '🚗', params: [
      { key: 'mass', label: '整备质量', unit: 'kg', min: 600, max: 2200, step: 10, desc: '越轻加速、刹车、过弯都更好。' },
      { key: 'frontWeight', label: '前轴配重', unit: '%', min: 0.35, max: 0.65, step: 0.01, desc: '前重 = 转向不足、刹车稳；后重 = 牵引好、容易甩尾。' },
      { key: 'cogHeight', label: '重心高度', unit: 'm', min: 0.3, max: 0.7, step: 0.01, desc: '越高载荷转移越大：更多侧倾、点头，抓地力下降。' },
      { key: 'wheelbase', label: '轴距', unit: 'm', min: 2.2, max: 3.0, step: 0.02, desc: '长轴距高速稳定，短轴距转向灵活。' },
      { key: 'trackWidth', label: '轮距', unit: 'm', min: 1.4, max: 1.8, step: 0.01, desc: '越宽横向载荷转移越小，过弯越稳。' },
    ],
  },
  {
    id: 'susp', label: '悬挂', icon: '🪀', params: [
      { key: 'springF', label: '前弹簧刚度', unit: 'N/mm', min: 20, max: 250, step: 5, desc: '越硬侧倾越小、响应越快，但颠簸时抓地力下降。前硬 = 更推头。' },
      { key: 'springR', label: '后弹簧刚度', unit: 'N/mm', min: 20, max: 250, step: 5, desc: '后硬 = 更转向过度。' },
      { key: 'bumpF', label: '前压缩阻尼', unit: 'kN·s/m', min: 0.5, max: 10, step: 0.1, desc: '控制压缩速度。影响刹车点头和入弯瞬态。' },
      { key: 'bumpR', label: '后压缩阻尼', unit: 'kN·s/m', min: 0.5, max: 10, step: 0.1, desc: '控制后轴压缩速度，影响加速蹲尾。' },
      { key: 'reboundF', label: '前回弹阻尼', unit: 'kN·s/m', min: 0.5, max: 12, step: 0.1, desc: '控制伸展速度。太低会晃，太高轮胎跟地不好。' },
      { key: 'reboundR', label: '后回弹阻尼', unit: 'kN·s/m', min: 0.5, max: 12, step: 0.1, desc: '控制后轴伸展速度。' },
      { key: 'arbF', label: '前防倾杆', unit: 'N/mm', min: 0, max: 200, step: 5, desc: '越硬前轴承担更多横向载荷转移 → 更推头。' },
      { key: 'arbR', label: '后防倾杆', unit: 'N/mm', min: 0, max: 200, step: 5, desc: '越硬后轴承担更多载荷转移 → 更甩尾。' },
      { key: 'rideHeightF', label: '前车高', unit: 'mm', min: 50, max: 200, step: 1, desc: '越低重心越低、下压力越大，但太低+太软会触底。前低后高（Rake）增加前下压力。' },
      { key: 'rideHeightR', label: '后车高', unit: 'mm', min: 50, max: 200, step: 1, desc: '后车高。' },
      { key: 'travel', label: '悬挂行程', unit: 'mm', min: 40, max: 200, step: 5, desc: '超出行程后撞击限位块，刚度剧增。' },
    ],
  },
  {
    id: 'align', label: '四轮定位', icon: '📐', params: [
      { key: 'camberF', label: '前外倾角', unit: '°', min: -6, max: 2, step: 0.1, desc: '负外倾补偿车身侧倾，提升过弯抓地；太多会降低刹车和直线牵引。' },
      { key: 'camberR', label: '后外倾角', unit: '°', min: -6, max: 2, step: 0.1, desc: '后轴外倾。' },
      { key: 'toeF', label: '前束角(前)', unit: '°', min: -1, max: 1, step: 0.05, desc: '正 = 内束（直线稳）；负 = 外束（入弯更灵敏）。都会增加滚动阻力。' },
      { key: 'toeR', label: '前束角(后)', unit: '°', min: -1, max: 1, step: 0.05, desc: '后轴内束增加稳定性，外束会让车尾很活。' },
      { key: 'caster', label: '主销后倾', unit: '°', min: 0, max: 10, step: 0.5, desc: '越大转向回正越快、转向时外倾增益越多、高速越稳。' },
    ],
  },
  {
    id: 'tire', label: '轮胎', icon: '🛞', params: [
      { key: 'tireGrip', label: '胎面配方抓地', unit: 'μ', min: 0.6, max: 1.8, step: 0.02, desc: '摩擦系数。街胎约 0.95，半热熔 1.2，热熔 1.5。' },
      { key: 'tireWidthF', label: '前胎宽', unit: 'mm', min: 165, max: 335, step: 5, desc: '越宽抓地越高，峰值滑移角越小（响应更锐利）。' },
      { key: 'tireWidthR', label: '后胎宽', unit: 'mm', min: 165, max: 355, step: 5, desc: '后胎宽，影响出弯牵引和后轴稳定。' },
      { key: 'tirePressure', label: '胎压', unit: 'psi', min: 18, max: 42, step: 0.5, desc: '28 psi 左右抓地最佳；低胎压更软更钝，高胎压更利落但抓地下降。' },
      { key: 'tireFalloff', label: '极限后衰减', min: 0, max: 1, step: 0.05, desc: '超过极限后抓地力下降多少。越大越难控制滑动。' },
    ],
  },
  {
    id: 'brake', label: '刹车', icon: '🛑', params: [
      { key: 'brakeTorque', label: '刹车力矩', unit: 'Nm', min: 1500, max: 9000, step: 100, desc: '全力刹车时的总力矩。太大容易抱死（除非有 ABS）。' },
      { key: 'brakeBias', label: '刹车前后比', unit: '% 前', min: 0.4, max: 0.8, step: 0.01, desc: '偏前稳定但前轮易抱死推头；偏后刹车时车尾易滑。' },
      { key: 'abs', label: 'ABS', kind: 'bool', desc: '防抱死：检测轮胎抱死并释放刹车。' },
      { key: 'handbrakeTorque', label: '手刹力矩', unit: 'Nm', min: 0, max: 4000, step: 100, desc: '空格键，仅作用于后轮。' },
    ],
  },
  {
    id: 'aero', label: '空气动力', icon: '🌬️', params: [
      { key: 'downforceF', label: '前下压力', unit: 'ClA', min: 0, max: 1.6, step: 0.05, desc: '前唇/扩散器。随速度平方增加前轴抓地。' },
      { key: 'downforceR', label: '后下压力(尾翼)', unit: 'ClA', min: 0, max: 2.2, step: 0.05, desc: '尾翼角度。高速弯稳定，但增加阻力、降低极速。' },
      { key: 'dragCd', label: '风阻系数', unit: 'Cd', min: 0.22, max: 0.6, step: 0.01, desc: '车身风阻，决定极速。' },
    ],
  },
  {
    id: 'steer', label: '转向', icon: '🎯', params: [
      { key: 'steerLock', label: '最大转向角', unit: '°', min: 15, max: 45, step: 1, desc: '低速最大转角。' },
      { key: 'steerSpeed', label: '转向速度', unit: '/s', min: 1, max: 8, step: 0.1, desc: '方向盘打满的速度（键盘）。' },
      { key: 'steerSensitivity', label: '速度敏感转向', min: 0, max: 1, step: 0.05, desc: '车速越高自动减少转角，避免键盘输入过猛。' },
      { key: 'ackermann', label: '阿克曼', unit: '%', min: 0, max: 1, step: 0.05, desc: '内侧轮多转一点。高 = 低速弯更顺，低 = 高速弯更好。' },
    ],
  },
  {
    id: 'assist', label: '辅助', icon: '🛟', params: [
      { key: 'tcs', label: '牵引力控制 TCS', kind: 'bool', desc: '驱动轮打滑时自动降低扭矩。' },
      { key: 'stability', label: '车身稳定辅助', min: 0, max: 1, step: 0.05, desc: '抑制过大的横摆角速度，防止打转。' },
    ],
  },
];

export const DEFAULT_SETUP: CarSetup = {
  id: 'gt',
  name: 'GT 跑车',
  builtin: true,
  color: '#e63946',
  accent: '#ffffff',
  maxTorque: 420,
  peakTorqueRpm: 5200,
  redline: 7600,
  idleRpm: 900,
  engineInertia: 0.18,
  engineBraking: 0.4,
  gearCount: 6,
  firstGear: 3.3,
  topGear: 0.82,
  finalDrive: 3.7,
  shiftTime: 0.12,
  autoShift: true,
  drivetrain: 'RWD',
  awdFrontSplit: 0.4,
  diffType: 'lsd',
  lsdPreload: 60,
  lsdLock: 0.35,
  mass: 1300,
  frontWeight: 0.5,
  cogHeight: 0.46,
  wheelbase: 2.6,
  trackWidth: 1.6,
  springF: 90,
  springR: 80,
  bumpF: 3.5,
  bumpR: 3.2,
  reboundF: 5.5,
  reboundR: 5.0,
  arbF: 60,
  arbR: 35,
  rideHeightF: 100,
  rideHeightR: 105,
  travel: 90,
  camberF: -2.5,
  camberR: -1.6,
  toeF: -0.05,
  toeR: 0.15,
  caster: 6,
  tireGrip: 1.2,
  tireWidthF: 245,
  tireWidthR: 275,
  tirePressure: 28,
  tireFalloff: 0.35,
  brakeTorque: 5200,
  brakeBias: 0.62,
  abs: true,
  handbrakeTorque: 2500,
  downforceF: 0.35,
  downforceR: 0.6,
  dragCd: 0.34,
  steerLock: 32,
  steerSpeed: 3.2,
  steerSensitivity: 0.55,
  ackermann: 0.5,
  tcs: false,
  stability: 0.2,
};

export const BUILTIN_CARS: CarSetup[] = [
  DEFAULT_SETUP,
  {
    ...DEFAULT_SETUP,
    id: 'hatch',
    name: '街道小钢炮',
    color: '#2f6fdf',
    accent: '#ffd23f',
    maxTorque: 280,
    peakTorqueRpm: 4200,
    redline: 6800,
    engineInertia: 0.14,
    gearCount: 5,
    firstGear: 3.5,
    topGear: 0.9,
    finalDrive: 4.1,
    shiftTime: 0.25,
    drivetrain: 'FWD',
    diffType: 'open',
    mass: 1080,
    frontWeight: 0.61,
    cogHeight: 0.52,
    wheelbase: 2.45,
    trackWidth: 1.5,
    springF: 45,
    springR: 40,
    bumpF: 2.2,
    bumpR: 2,
    reboundF: 3.2,
    reboundR: 3,
    arbF: 25,
    arbR: 45,
    rideHeightF: 130,
    rideHeightR: 130,
    travel: 120,
    camberF: -1,
    camberR: -0.8,
    toeF: 0,
    toeR: 0.1,
    caster: 4,
    tireGrip: 0.98,
    tireWidthF: 205,
    tireWidthR: 205,
    tirePressure: 32,
    tireFalloff: 0.25,
    brakeTorque: 3600,
    brakeBias: 0.68,
    downforceF: 0,
    downforceR: 0.05,
    dragCd: 0.32,
    steerLock: 34,
    tcs: true,
    stability: 0.4,
  },
  {
    ...DEFAULT_SETUP,
    id: 'rally',
    name: '拉力四驱',
    color: '#43aa8b',
    accent: '#f3722c',
    maxTorque: 460,
    peakTorqueRpm: 4000,
    redline: 7200,
    engineInertia: 0.12,
    firstGear: 3.1,
    topGear: 0.9,
    finalDrive: 4.3,
    shiftTime: 0.08,
    drivetrain: 'AWD',
    awdFrontSplit: 0.4,
    diffType: 'lsd',
    lsdPreload: 90,
    lsdLock: 0.5,
    mass: 1250,
    frontWeight: 0.56,
    cogHeight: 0.5,
    wheelbase: 2.52,
    trackWidth: 1.55,
    springF: 55,
    springR: 50,
    bumpF: 3,
    bumpR: 2.8,
    reboundF: 4.5,
    reboundR: 4.2,
    arbF: 30,
    arbR: 30,
    rideHeightF: 140,
    rideHeightR: 145,
    travel: 150,
    camberF: -1.8,
    camberR: -1.2,
    caster: 5,
    tireGrip: 1.1,
    tireWidthF: 225,
    tireWidthR: 225,
    brakeTorque: 4800,
    brakeBias: 0.58,
    handbrakeTorque: 3500,
    downforceF: 0.2,
    downforceR: 0.5,
    dragCd: 0.38,
    steerLock: 36,
    steerSpeed: 4,
    tcs: false,
    stability: 0.1,
  },
  {
    ...DEFAULT_SETUP,
    id: 'drift',
    name: '漂移怪兽',
    color: '#9b5de5',
    accent: '#f15bb5',
    maxTorque: 620,
    peakTorqueRpm: 4800,
    redline: 7800,
    engineInertia: 0.1,
    firstGear: 3.0,
    finalDrive: 4.0,
    diffType: 'locked',
    mass: 1250,
    frontWeight: 0.53,
    springF: 110,
    springR: 70,
    arbF: 90,
    arbR: 20,
    camberF: -4.5,
    camberR: -0.5,
    toeF: -0.3,
    toeR: 0,
    caster: 8,
    tireGrip: 1.0,
    tireWidthF: 235,
    tireWidthR: 235,
    tireFalloff: 0.15,
    brakeBias: 0.55,
    handbrakeTorque: 4000,
    abs: false,
    downforceF: 0,
    downforceR: 0.15,
    steerLock: 45,
    steerSpeed: 5,
    steerSensitivity: 0.2,
    ackermann: 0.1,
    stability: 0,
  },
  {
    ...DEFAULT_SETUP,
    id: 'proto',
    name: '赛道原型车',
    color: '#ffd23f',
    accent: '#1c1c1f',
    maxTorque: 540,
    peakTorqueRpm: 6500,
    redline: 9200,
    engineInertia: 0.08,
    gearCount: 7,
    firstGear: 3.0,
    topGear: 0.78,
    finalDrive: 3.6,
    shiftTime: 0.05,
    mass: 980,
    frontWeight: 0.44,
    cogHeight: 0.36,
    wheelbase: 2.7,
    trackWidth: 1.72,
    springF: 160,
    springR: 150,
    bumpF: 6,
    bumpR: 5.5,
    reboundF: 8,
    reboundR: 7.5,
    arbF: 110,
    arbR: 70,
    rideHeightF: 65,
    rideHeightR: 75,
    travel: 60,
    camberF: -3.2,
    camberR: -2.2,
    tireGrip: 1.55,
    tireWidthF: 285,
    tireWidthR: 325,
    brakeTorque: 7200,
    brakeBias: 0.58,
    downforceF: 1.1,
    downforceR: 1.7,
    dragCd: 0.42,
    steerLock: 26,
    stability: 0.1,
  },
];

export function gearRatios(s: CarSetup): number[] {
  const n = Math.max(2, Math.round(s.gearCount));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(s.firstGear * Math.pow(s.topGear / s.firstGear, i / (n - 1)));
  return out;
}

export function engineTorqueCurve(s: CarSetup, rpm: number): number {
  const idle = s.idleRpm;
  const peak = Math.max(idle + 200, Math.min(s.peakTorqueRpm, s.redline - 300));
  if (rpm <= peak) {
    const k = Math.max(0, (rpm - idle) / (peak - idle));
    return s.maxTorque * (0.55 + 0.45 * Math.sin((Math.PI / 2) * Math.min(1, k)));
  }
  const k = Math.min(1.2, (rpm - peak) / (s.redline - peak));
  return s.maxTorque * (1 - 0.38 * Math.pow(k, 1.5));
}

export function peakPower(s: CarSetup): { kw: number; hp: number; rpm: number } {
  let best = 0, bestRpm = 0;
  for (let r = s.idleRpm; r <= s.redline; r += 50) {
    const p = engineTorqueCurve(s, r) * r * (2 * Math.PI / 60);
    if (p > best) { best = p; bestRpm = r; }
  }
  return { kw: best / 1000, hp: best / 745.7, rpm: bestRpm };
}

export function cloneSetup(s: CarSetup): CarSetup {
  return JSON.parse(JSON.stringify(s));
}

/** Fill any missing keys (e.g. from older saves) with defaults. */
export function normalizeSetup(s: Partial<CarSetup>): CarSetup {
  return { ...DEFAULT_SETUP, builtin: false, ...s } as CarSetup;
}
