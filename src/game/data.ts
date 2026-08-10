// 游戏数据定义：地图、炮塔、敌人、波次

export type TowerType = 'pulse' | 'missile' | 'beam' | 'slow'

export interface TowerDef {
  type: TowerType
  name: string
  cost: number
  range: number
  fireRate: number // 每秒攻击次数
  damage: number
  color: number
  desc: string
  slowFactor?: number // slow 塔：减速比例
  slowDuration?: number // slow 塔：减速时长(秒)
  splashRadius?: number // missile 塔：溅射半径
  upgradeMultiplier: number // 每级成长系数
  maxLevel: number
}

export const TOWER_DEFS: Record<TowerType, TowerDef> = {
  pulse: {
    type: 'pulse', name: '脉冲炮', cost: 50, range: 8, fireRate: 2, damage: 10, color: 0x4fd1ff,
    desc: '快速单目标，性价比之选', upgradeMultiplier: 1.6, maxLevel: 4,
  },
  missile: {
    type: 'missile', name: '导弹塔', cost: 100, range: 10, fireRate: 0.7, damage: 30, color: 0xff8a3d,
    splashRadius: 3, desc: '范围溅射，对付集群', upgradeMultiplier: 1.7, maxLevel: 4,
  },
  beam: {
    type: 'beam', name: '光束塔', cost: 150, range: 7, fireRate: 4, damage: 14, color: 0x9f7cff,
    desc: '高射速持续输出，火力核心', upgradeMultiplier: 1.8, maxLevel: 4,
  },
  slow: {
    type: 'slow', name: '减速塔', cost: 80, range: 6, fireRate: 0, damage: 0, color: 0x3dd6d0,
    slowFactor: 0.55, slowDuration: 1.8, desc: '减速范围内敌人', upgradeMultiplier: 1.4, maxLevel: 3,
  },
}

// ===== 敌人类型 =====
export type EnemyType = 'scout' | 'raider' | 'tank' | 'swarm' | 'boss'

export interface EnemyDef {
  type: EnemyType
  name: string
  hp: number
  speed: number // 单位/秒
  reward: number // 击杀奖励
  damage: number // 漏掉扣生命
  color: number
  radius: number
  scale: number
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  scout:  { type: 'scout',  name: '侦察机', hp: 30,   speed: 4.2, reward: 8,  damage: 1, color: 0x4fd1ff, radius: 0.45, scale: 0.7 },
  raider: { type: 'raider', name: '劫掠者', hp: 70,   speed: 3.2, reward: 14, damage: 2, color: 0xff8a3d, radius: 0.55, scale: 0.85 },
  tank:   { type: 'tank',   name: '重装舰', hp: 220,  speed: 1.8, reward: 30, damage: 4, color: 0xff5d5d, radius: 0.75, scale: 1.1 },
  swarm:  { type: 'swarm',  name: '蜂群',   hp: 18,   speed: 5.0, reward: 5,  damage: 1, color: 0x9f7cff, radius: 0.35, scale: 0.5 },
  boss:   { type: 'boss',   name: '旗舰',   hp: 1600, speed: 0.9, reward: 200, damage: 10, color: 0xff3b6b, radius: 1.4, scale: 2.2 },
}

// ===== 地图：路径点（坐标以基地中心为原点，y=0 平面） =====
// 每个地图一个起点，路径沿点走，终点是基地。
export interface MapDef {
  id: string
  name: string
  waves: number // 完整版包含的波次数
  path: [number, number][] // [x,z] 路径点
  startCredits: number
  startLives: number
  free: boolean // 试玩免费
}

export const MAPS: MapDef[] = [
  {
    id: 'alpha', name: '阿尔法哨站', waves: 12, free: true,
    startCredits: 120, startLives: 20,
    path: [
      [-14, -9], [0, -9], [0, 9], [-7, 9], [-7, -1], [10, -1], [10, 7], [14, 7],
    ],
  },
  {
    id: 'beta', name: '贝塔防线', waves: 14, free: true,
    startCredits: 130, startLives: 20,
    path: [
      [-14, 0], [-4, 0], [-4, -8], [4, -8], [4, 4], [12, 4], [12, -4], [14, -4],
    ],
  },
  {
    id: 'gamma', name: '伽马迷宫', waves: 16, free: false,
    startCredits: 150, startLives: 22,
    path: [
      [-14, -10], [-14, 0], [-6, 0], [-6, 8], [2, 8], [2, -8], [8, -8], [8, 4], [14, 4],
    ],
  },
  {
    id: 'delta', name: '德尔塔星环', waves: 18, free: false,
    startCredits: 160, startLives: 22,
    path: [
      [0, -14], [0, -6], [-8, -6], [-8, 2], [6, 2], [6, -2], [-2, -2], [-2, 8], [8, 8], [8, 12],
    ],
  },
  {
    id: 'omega', name: '欧米茄终局', waves: 20, free: false,
    startCredits: 180, startLives: 25,
    path: [
      [-14, -10], [6, -10], [6, -2], [-6, -2], [-6, 6], [12, 6], [12, -6], [-12, -6], [-12, 8], [0, 8], [0, 12],
    ],
  },
]

// 波次生成器：给定波次号，返回该波敌人的类型与数量
export interface WaveSpawn { type: EnemyType; count: number }
export interface WaveDef { spawns: WaveSpawn[]; interval: number }

/** 无限波次生成：波次越高，敌人越强越多，间隔越短 */
export function waveFor(map: MapDef, waveNum: number): WaveDef {
  const w = waveNum
  const spawns: WaveSpawn[] = []
  // 每 5 波一个 Boss 波
  if (w % 5 === 0) {
    spawns.push({ type: 'boss', count: 1 + Math.floor(w / 10) })
    spawns.push({ type: 'raider', count: 2 + Math.floor(w / 3) })
    return { spawns, interval: 1.4 }
  }
  const t = Math.min(w / map.waves, 1) // 0→1 难度系数
  // 基础组合随难度演进
  if (t < 0.25) {
    spawns.push({ type: 'scout', count: 4 + w * 2 })
    if (w >= 3) spawns.push({ type: 'raider', count: Math.floor(w / 2) })
  } else if (t < 0.5) {
    spawns.push({ type: 'scout', count: 3 + w })
    spawns.push({ type: 'raider', count: 2 + Math.floor(w * 0.7) })
    if (w >= 8) spawns.push({ type: 'tank', count: Math.floor(w / 4) })
  } else if (t < 0.75) {
    spawns.push({ type: 'raider', count: 3 + Math.floor(w * 0.8) })
    spawns.push({ type: 'tank', count: 1 + Math.floor(w / 3) })
    spawns.push({ type: 'swarm', count: 4 + w })
  } else {
    spawns.push({ type: 'tank', count: 2 + Math.floor(w / 2) })
    spawns.push({ type: 'swarm', count: 6 + w })
    spawns.push({ type: 'raider', count: 3 + Math.floor(w * 0.5) })
  }
  // HP 成长系数（让数值永不失控）
  const interval = Math.max(0.45, 0.9 - w * 0.012)
  return { spawns, interval }
}

// 基地位置（路径最后一个点的外推）
export function basePosition(map: MapDef): [number, number] {
  const last = map.path[map.path.length - 1]
  const prev = map.path[map.path.length - 2]
  const dx = last[0] - prev[0]
  const dz = last[1] - prev[1]
  const len = Math.hypot(dx, dz) || 1
  return [last[0] + (dx / len) * 2, last[1] + (dz / len) * 2]
}
