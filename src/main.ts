import './style.css'
import { MAPS, TOWER_DEFS, type MapDef, type TowerType } from './game/data'
import { TOWER_UNLOCKS } from './game/meta'
import { TowerGame } from './game/engine'
import { isFullVersion } from './game/paid'
import { bindRedeem } from './game/redeem'
import {
  getStardust, addStardust, totalStars, getMapStars, recordStars,
  isMapUnlocked, mapStarCost, RESEARCH_DEFS, getResearchLevel,
  researchCost, researchUpgrade, getModifiers,
  isTowerUnlocked, unlockTowerCost, unlockTower,
  computeStardust, computeStars,
} from './game/meta'
import { initAudio, resumeAudio, setMusicOn, setSfxOn, isMusicOn, isSfxOn } from './game/audio'

let game: TowerGame | null = null
let currentMap: MapDef | null = null
let currentCredits = 0

const $ = (id: string) => document.getElementById(id)!

// ===== 主菜单 =====
function buildMenu() {
  const full = isFullVersion()
  // 顶部星尘/星星
  $('hud-stardust').textContent = String(getStardust())
  $('hud-totalstars').textContent = `${totalStars()} ★`

  const list = $('map-list')
  list.innerHTML = ''
  MAPS.forEach((m) => {
    const unlocked = full || isMapUnlocked(m.id)
    const stars = getMapStars(m.id)
    const starStr = '★'.repeat(stars) + '☆'.repeat(3 - stars)
    const cost = full ? 0 : mapStarCost(m.id)
    const row = document.createElement('div')
    row.className = 'map-row' + (unlocked ? '' : ' locked')
    row.innerHTML = `
      <div>
        <div class="map-name">${m.name} <span class="map-stars">${starStr}</span></div>
        <div class="map-waves">${m.waves} 波</div>
      </div>
      ${unlocked
        ? `<span class="map-tag free">${m.free ? '免费' : full ? '完整版' : '已解锁'}</span>`
        : `<span class="map-tag lock">🔒 需 ${cost} ★</span>`}
    `
    if (unlocked) row.addEventListener('click', () => startGame(m))
    list.appendChild(row)
  })

  $('menu-full-text').textContent = full
    ? '完整版 · 已解锁全部关卡与科技树'
    : `试玩版 · 免费体验第 1 关 · 完整版 ¥8 解锁全部 ${MAPS.length} 关`
}

// ===== 科技树面板 =====
function buildTechTree() {
  const list = $('research-list')
  list.innerHTML = ''
  RESEARCH_DEFS.forEach((r) => {
    const lv = getResearchLevel(r.id)
    const cost = researchCost(r.id)
    const maxed = lv >= r.maxLevel
    const row = document.createElement('div')
    row.className = 'research-row' + (maxed ? ' maxed' : '')
    row.innerHTML = `
      <div class="res-info">
        <div class="res-name">${r.name} <span class="res-lv">Lv.${lv}/${r.maxLevel}</span></div>
        <div class="res-desc">${r.desc} · ${r.effectText(lv)}</div>
      </div>
      <button class="res-btn" ${maxed ? 'disabled' : ''}>${maxed ? '满级' : `升级 ◈${cost}`}</button>
    `
    if (!maxed) {
      row.querySelector('button')!.addEventListener('click', () => {
        if (researchUpgrade(r.id)) {
          buildTechTree()
          $('hud-stardust').textContent = String(getStardust())
          buildMenu()
        }
      })
    }
    list.appendChild(row)
  })

  // 额外塔解锁
  const towers = $('tower-unlock-list')
  towers.innerHTML = ''
  TOWER_UNLOCKS.forEach((t) => {
    const unlocked = isTowerUnlocked(t.type)
    const cost = unlockTowerCost(t.type)
    const row = document.createElement('div')
    row.className = 'research-row'
    row.innerHTML = `
      <div class="res-info">
        <div class="res-name">${t.name}</div>
        <div class="res-desc">${t.desc}</div>
      </div>
      ${unlocked ? '<button class="res-btn" disabled>已解锁</button>'
        : `<button class="res-btn">解锁 ◈${cost}</button>`}
    `
    if (!unlocked) {
      row.querySelector('button')!.addEventListener('click', () => {
        if (unlockTower(t.type)) {
          buildTechTree()
          $('hud-stardust').textContent = String(getStardust())
          buildMenu()
        }
      })
    }
    towers.appendChild(row)
  })
}

function startGame(map: MapDef) {
  // 先展示剧情简报，确认后再真正开局
  $('menu-screen').classList.add('hidden')
  $('story-screen').classList.remove('hidden')
  $('story-title').textContent = `📜 ${map.name}`
  $('story-text').textContent = map.story || '敌舰逼近，指挥官。准备防御。'
  $('story-warning').textContent = `${map.waves} 波来袭 · 每 5 波一艘旗舰`
  ;(window as any).__pendingMap = map
}

function actuallyStartGame(map: MapDef) {
  currentMap = map
  $('story-screen').classList.add('hidden')
  $('end-screen').classList.add('hidden')
  if (game) { game.destroy(); game = null }
  currentCredits = map.startCredits

  const mods = getModifiers()
  currentCredits += mods.startCreditsBonus
  const canvas = $('game-canvas') as HTMLCanvasElement
  game = new TowerGame(canvas, map, {
    onWaveChange: (wave) => {
      $('wave-num').textContent = String(wave)
      if (wave > 0) {
        // 波次横幅带敌人预告（每5波Boss）
        if (wave % 5 === 0) showBanner(`⚠️ 第 ${wave} 波 · 旗舰「湮灭者」来袭！`)
        else showBanner(`第 ${wave} 波`)
      }
    },
    onCredits: (c) => {
      currentCredits = c
      $('credits-num').textContent = String(c)
      refreshTowerBar()
      if (game?.selectedTower) game.showPanel(game.selectedTower)
    },
    onLives: (l) => $('lives-num').textContent = String(l),
    onGameOver: (wave, kills) => endGame(false, wave, kills),
    onVictory: (wave) => endGame(true, wave, game!.kills),
  }, mods)

  setBuilding(null)
  $('wave-num').textContent = '0'
  $('lives-num').textContent = String(map.startLives + mods.livesBonus)
  game.lives = map.startLives + mods.livesBonus
  $('credits-num').textContent = String(currentCredits)
  refreshTowerBar()
  ;(window as any).__game = game

  setTimeout(() => {
    if (game && game.wave === 0 && !game.gameOver) game.startWave()
  }, 4000)
}

function showBanner(text: string) {
  const b = $('wave-banner')
  b.textContent = text
  b.classList.remove('hidden')
  void b.offsetWidth
  b.style.animation = 'none'
  void b.offsetWidth
  b.style.animation = ''
}

function endGame(won: boolean, wave: number, kills: number) {
  const map = currentMap!
  const livesLeft = Math.max(0, game?.lives ?? 0)
  const totalLives = map.startLives
  const stars = computeStars(wave, kills, livesLeft, totalLives, map.waves)
  const stardust = computeStardust(wave, kills, livesLeft, totalLives)

  // 结算星尘
  addStardust(stardust)
  // 记录星星
  recordStars(map.id, stars)

  $('end-title').textContent = won ? '🏆 通关！' : '☠️ 基地沦陷'
  $('end-info').innerHTML = `
    <div class="end-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
    <div>到达第 ${wave} 波 · 击毁 ${kills} 架</div>
    <div class="end-stardust">星尘 +${stardust}</div>
  `
  $('hud-stardust').textContent = String(getStardust())
  $('end-screen').classList.remove('hidden')
}

function refreshTowerBar() {
  document.querySelectorAll<HTMLElement>('.tower-btn').forEach((el) => {
    const type = el.dataset.tower as TowerType
    const def = TOWER_DEFS[type]
    // 未解锁的塔隐藏或置灰
    const unlocked = def.cost <= 220 || isTowerUnlocked(type)
    if (!unlocked) {
      el.classList.add('locked-tower')
      el.style.display = 'none'
      return
    }
    el.style.display = ''
    el.classList.toggle('affordable', currentCredits >= def.cost)
    el.style.opacity = currentCredits >= def.cost ? '1' : '0.45'
  })
}

function setBuilding(type: TowerType | null) {
  document.querySelectorAll<HTMLElement>('.tower-btn').forEach((el) => {
    const t = el.dataset.tower as TowerType
    el.classList.toggle('selected', t === type)
  })
  if (game) {
    if (type) game.build(type)
    else game.selectTower(null)
  }
}

function bindUI() {
  // 主菜单按钮
  $('btn-tech').addEventListener('click', () => {
    $('menu-screen').classList.add('hidden')
    $('tech-screen').classList.remove('hidden')
    $('tech-stardust').textContent = String(getStardust())
    buildTechTree()
  })
  $('btn-tech-back').addEventListener('click', () => {
    $('tech-screen').classList.add('hidden')
    $('menu-screen').classList.remove('hidden')
    buildMenu()
  })
  // 剧情简报 → 开始战斗
  $('story-start').addEventListener('click', () => {
    const map = (window as any).__pendingMap as MapDef | undefined
    if (map) actuallyStartGame(map)
  })

  // 设置面板
  $('btn-settings').addEventListener('click', () => {
    $('settings-modal').classList.remove('hidden')
    renderSettings()
  })
  $('settings-close').addEventListener('click', () => {
    $('settings-modal').classList.add('hidden')
  })
  $('music-toggle').addEventListener('click', () => {
    setMusicOn(!isMusicOn())
    renderSettings()
  })
  $('sfx-toggle').addEventListener('click', () => {
    setSfxOn(!isSfxOn())
    renderSettings()
  })

  // 选塔栏
  document.querySelectorAll<HTMLElement>('.tower-btn').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const type = el.dataset.tower as TowerType
      if (currentCredits < TOWER_DEFS[type].cost) return
      const building = el.classList.contains('selected') ? null : type
      setBuilding(building)
    })
  })

  $('btn-upgrade').addEventListener('click', () => game?.upgradeSelected())
  $('btn-sell').addEventListener('click', () => game?.sellSelected())

  $('btn-speed').addEventListener('click', () => {
    const s = game?.speed === 1 ? 2 : 1
    game?.setSpeed(s)
    $('btn-speed').textContent = s === 1 ? '⏩' : '⏩⏩'
  })

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && game && game.waveState === 'idle' && !game.gameOver) {
      e.preventDefault()
      game.startWave()
    }
    if (e.code === 'Escape') {
      if (game?.selectedTower) game.selectTower(null)
      setBuilding(null)
    }
  })

  $('btn-retry').addEventListener('click', () => {
    if (currentMap) startGame(currentMap)
  })
  $('btn-menu').addEventListener('click', () => {
    if (game) { game.destroy(); game = null }
    $('end-screen').classList.add('hidden')
    $('menu-screen').classList.remove('hidden')
    buildMenu()
  })

  bindRedeem(() => {
    buildMenu()
  })

  const nextBtn = document.createElement('button')
  nextBtn.id = 'btn-next-wave'
  nextBtn.textContent = '▶ 下一波'
  Object.assign(nextBtn.style, {
    position: 'absolute', left: '50%', bottom: '76px', transform: 'translateX(-50%)',
    zIndex: '10', padding: '8px 18px', fontSize: '14px', fontWeight: '700',
    background: 'rgba(79,209,255,0.15)', color: '#4fd1ff',
    border: '1px solid rgba(79,209,255,0.5)', borderRadius: '10px', cursor: 'pointer',
  })
  nextBtn.addEventListener('click', () => {
    if (game && game.waveState === 'idle' && !game.gameOver) game.startWave()
  })
  document.getElementById('app')!.appendChild(nextBtn)
  setInterval(() => {
    nextBtn.style.display =
      game && game.waveState === 'idle' && !game.gameOver && game.wave > 0 ? 'block' : 'none'
  }, 200)
}

function renderSettings() {
  $('music-toggle').textContent = isMusicOn() ? '音乐：开' : '音乐：关'
  $('sfx-toggle').textContent = isSfxOn() ? '音效：开' : '音效：关'
}

// ===== 初始化 =====
initAudio()
bindUI()
buildMenu()
// 首次点击时解锁音频（浏览器策略）
window.addEventListener('pointerdown', resumeAudio, { once: true })
