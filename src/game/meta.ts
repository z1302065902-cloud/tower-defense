// 局外养成系统：星尘货币 + 科技树 + 星星评价 + 地图解锁
// 所有数据存 localStorage，跨局持久化。

import type { TowerType } from './data'

const META_KEY = 'td-meta-v1'

export interface MetaSave {
  stardust: number
  stars: Record<string, number> // mapId -> 最高星数 0..3
  research: Record<string, number> // 科技id -> 等级
  unlockedTowers: TowerType[] // 已解锁的额外塔
}

function defaultSave(): MetaSave {
  return { stardust: 0, stars: {}, research: {}, unlockedTowers: [] }
}

function read(): MetaSave {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return defaultSave()
    const p = JSON.parse(raw) as Partial<MetaSave>
    return {
      stardust: Number(p.stardust) || 0,
      stars: p.stars || {},
      research: p.research || {},
      unlockedTowers: Array.isArray(p.unlockedTowers) ? p.unlockedTowers : [],
    }
  } catch {
    return defaultSave()
  }
}

function write(s: MetaSave) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

// ===== 星尘 =====
export function getStardust(): number {
  return read().stardust
}
export function addStardust(n: number) {
  const s = read()
  s.stardust = Math.max(0, Math.floor(s.stardust + n))
  write(s)
}
export function canAfford(n: number): boolean {
  return read().stardust >= n
}

// ===== 星星评价 =====
export function getMapStars(mapId: string): number {
  return read().stars[mapId] || 0
}
/** 记录某张图的最好评星（取最高），返回是否刷新了记录 */
export function recordStars(mapId: string, stars: number): boolean {
  const s = read()
  const cur = s.stars[mapId] || 0
  if (stars > cur) {
    s.stars[mapId] = stars
    write(s)
    return true
  }
  return false
}
export function totalStars(): number {
  const s = read()
  return Object.values(s.stars).reduce((a, b) => a + b, 0)
}

// ===== 地图解锁（按累计星星） =====
// 完整版玩家不受此限制（main.ts 里判断 isFullVersion 直接全开）
export function mapStarCost(mapId: string): number {
  const costs: Record<string, number> = {
    alpha: 0,
    beta: 2,
    gamma: 6,
    delta: 12,
    omega: 20,
  }
  return costs[mapId] ?? 0
}
export function isMapUnlocked(mapId: string): boolean {
  return totalStars() >= mapStarCost(mapId)
}

// ===== 科技树 =====
export interface ResearchDef {
  id: string
  name: string
  desc: string
  maxLevel: number
  /** 每级成本（星尘） */
  cost: (level: number) => number
  /** 每级效果描述 */
  effectText: (level: number) => string
}

export const RESEARCH_DEFS: ResearchDef[] = [
  {
    id: 'start_credits', name: '资金扶持', desc: '每局起始金币',
    maxLevel: 3, cost: (l) => [0, 40, 90, 200][l],
    effectText: (l) => `起始金币 +${l * 20}`,
  },
  {
    id: 'dmg', name: '火力升级', desc: '全塔伤害',
    maxLevel: 3, cost: (l) => [0, 50, 120, 260][l],
    effectText: (l) => `全塔伤害 +${l * 10}%`,
  },
  {
    id: 'rate', name: '急速指令', desc: '全塔攻击速度',
    maxLevel: 3, cost: (l) => [0, 50, 120, 260][l],
    effectText: (l) => `全塔攻速 +${l * 8}%`,
  },
  {
    id: 'range', name: '远程校准', desc: '全塔射程',
    maxLevel: 3, cost: (l) => [0, 45, 110, 240][l],
    effectText: (l) => `全塔射程 +${l * 8}%`,
  },
  {
    id: 'lives', name: '装甲加固', desc: '基地额外生命',
    maxLevel: 2, cost: (l) => [0, 80, 180][l],
    effectText: (l) => `基地生命 +${l * 2}`,
  },
]

export function getResearchLevel(id: string): number {
  return read().research[id] || 0
}
export function researchCost(id: string): number {
  const def = RESEARCH_DEFS.find((r) => r.id === id)
  if (!def) return -1
  const lv = getResearchLevel(id)
  if (lv >= def.maxLevel) return -1
  return def.cost(lv + 1)
}
/** 尝试升级科技，成功返回 true */
export function researchUpgrade(id: string): boolean {
  const def = RESEARCH_DEFS.find((r) => r.id === id)
  if (!def) return false
  const cost = researchCost(id)
  if (cost < 0 || !canAfford(cost)) return false
  const s = read()
  s.research[id] = (s.research[id] || 0) + 1
  s.stardust -= cost
  write(s)
  return true
}

// ===== 额外塔解锁 =====
export interface TowerUnlockDef {
  type: TowerType
  name: string
  cost: number
  desc: string
}

export const TOWER_UNLOCKS: TowerUnlockDef[] = [
  { type: 'frost', name: '冰霜塔', cost: 150, desc: '大范围强减速，配和增幅塔威力惊人' },
  { type: 'storm', name: '电击塔', cost: 250, desc: '闪电链弹射多个敌人' },
  { type: 'amp', name: '增幅塔', cost: 300, desc: '提升周围塔的伤害' },
  { type: 'plasma', name: '等离子塔', cost: 400, desc: '高伤穿透光束，后期主力' },
]

export function isTowerUnlocked(type: TowerType): boolean {
  return read().unlockedTowers.includes(type)
}
export function unlockTowerCost(type: TowerType): number {
  return TOWER_UNLOCKS.find((t) => t.type === type)?.cost ?? -1
}
export function unlockTower(type: TowerType): boolean {
  const def = TOWER_UNLOCKS.find((t) => t.type === type)
  if (!def || isTowerUnlocked(type)) return false
  if (!canAfford(def.cost)) return false
  const s = read()
  s.unlockedTowers.push(type)
  s.stardust -= def.cost
  write(s)
  return true
}

// ===== 综合加成（把科技等级换算成游戏内 modifier） =====
export interface GameModifiers {
  startCreditsBonus: number
  damageMul: number
  rateMul: number
  rangeMul: number
  livesBonus: number
}

export function getModifiers(): GameModifiers {
  const s = read()
  const lv = (id: string) => s.research[id] || 0
  return {
    startCreditsBonus: lv('start_credits') * 20,
    damageMul: 1 + lv('dmg') * 0.1,
    rateMul: 1 + lv('rate') * 0.08,
    rangeMul: 1 + lv('range') * 0.08,
    livesBonus: lv('lives') * 2,
  }
}

// ===== 结算：把本局表现换算成星尘 =====
export function computeStardust(wave: number, kills: number, livesLeft: number, totalLives: number): number {
  // 波数奖励 + 击杀奖励 + 剩余生命奖励（未通关时按比例）
  const waveReward = wave * 2
  const killReward = Math.floor(kills * 0.5)
  const lifeRatio = totalLives > 0 ? livesLeft / totalLives : 0
  const lifeReward = Math.round(lifeRatio * 10)
  return waveReward + killReward + lifeReward
}

/** 根据表现计算星级：通关2星，剩余生命≥70%给3星，未通关但过半给1星 */
export function computeStars(wave: number, _kills: number, livesLeft: number, totalLives: number, mapWaves: number): number {
  if (wave >= mapWaves) {
    return livesLeft / totalLives >= 0.7 ? 3 : 2
  }
  return wave >= mapWaves * 0.5 ? 1 : 0
}
