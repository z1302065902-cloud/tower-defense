import './style.css'
import { MAPS, TOWER_DEFS, type MapDef, type TowerType } from './game/data'
import { TowerGame } from './game/engine'
import { isFullVersion, TRIAL_MAPS } from './game/paid'
import { bindRedeem } from './game/redeem'

let game: TowerGame | null = null
let currentMap: MapDef | null = null
let currentCredits = 0

const $ = (id: string) => document.getElementById(id)!

// ===== 主菜单 / 地图选择 =====
function buildMenu() {
  const list = $('map-list')
  list.innerHTML = ''
  const full = isFullVersion()
  MAPS.forEach((m) => {
    const locked = !full && !m.free
    const row = document.createElement('div')
    row.className = 'map-row' + (locked ? ' locked' : '')
    row.innerHTML = `
      <div>
        <div class="map-name">${m.name}</div>
        <div class="map-waves">${m.waves} 波</div>
      </div>
      <span class="map-tag ${locked ? 'lock' : 'free'}">${locked ? '🔒 完整版' : '免费'}</span>
    `
    if (!locked) {
      row.addEventListener('click', () => startGame(m))
    }
    list.appendChild(row)
  })
  $('menu-full-text').textContent = full
    ? '完整版 · 已解锁全部 5 关'
    : `试玩版 · 免费体验第 1–${TRIAL_MAPS} 关 · 完整版 ¥8 解锁全部 ${MAPS.length} 关`
}

function startGame(map: MapDef) {
  currentMap = map
  $('menu-screen').classList.add('hidden')
  $('end-screen').classList.add('hidden')
  // 清掉旧的 game
  if (game) {
    game.destroy()
    game = null
  }
  currentCredits = map.startCredits

  const canvas = $('game-canvas') as HTMLCanvasElement
  game = new TowerGame(canvas, map, {
    onWaveChange: (wave) => {
      $('wave-num').textContent = String(wave)
      if (wave > 0) showBanner(`第 ${wave} 波`)
    },
    onCredits: (c) => {
      currentCredits = c
      $('credits-num').textContent = String(c)
      refreshTowerBar()
      if (game?.selectedTower) game.showPanel(game.selectedTower)
    },
    onLives: (l) => {
      $('lives-num').textContent = String(l)
    },
    onGameOver: (wave, kills) => endGame(false, wave, kills),
    onVictory: (wave) => endGame(true, wave, game!.kills),
  })

  // 隐藏 HUD 中的试玩角标
  const rib = document.getElementById('trial-ribbon')
  if (rib) rib.remove()

  // 重置塔栏选中状态
  setBuilding(null)

  // 自动开始第一波（给玩家一点准备时间）
  $('wave-num').textContent = '0'
  $('lives-num').textContent = String(map.startLives)
  $('credits-num').textContent = String(map.startCredits)

  refreshTowerBar()

  // 测试钩子：浏览器控制台可访问 game 实例（生产无副作用）
  ;(window as any).__game = game

  // 自动开始第一波（给玩家几秒建造准备）
  setTimeout(() => {
    if (game && game.wave === 0 && !game.gameOver) {
      game.startWave()
    }
  }, 4000)
}

function showBanner(text: string) {
  const b = $('wave-banner')
  b.textContent = text
  b.classList.remove('hidden')
  // 触发动画
  void b.offsetWidth
  b.style.animation = 'none'
  void b.offsetWidth
  b.style.animation = ''
}

function endGame(won: boolean, wave: number, kills: number) {
  $('end-title').textContent = won ? '🏆 通关！' : '☠️ 基地沦陷'
  $('end-info').textContent = `到达第 ${wave} 波 · 击毁 ${kills} 架`
  $('end-screen').classList.remove('hidden')
}

function refreshTowerBar() {
  document.querySelectorAll<HTMLElement>('.tower-btn').forEach((el) => {
    const type = el.dataset.tower as TowerType
    const cost = TOWER_DEFS[type].cost
    el.classList.toggle('affordable', currentCredits >= cost)
    el.style.opacity = currentCredits >= cost ? '1' : '0.45'
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

  // 升级 / 出售
  $('btn-upgrade').addEventListener('click', () => {
    game?.upgradeSelected()
  })
  $('btn-sell').addEventListener('click', () => {
    game?.sellSelected()
  })

  // 变速
  $('btn-speed').addEventListener('click', () => {
    const s = game?.speed === 1 ? 2 : 1
    game?.setSpeed(s)
    $('btn-speed').textContent = s === 1 ? '⏩' : '⏩⏩'
  })

  // 波次开始：点击空白处开新波（用键盘快捷键 Space 或按钮）
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

  // 结束屏幕
  $('btn-retry').addEventListener('click', () => {
    if (currentMap) startGame(currentMap)
  })
  $('btn-menu').addEventListener('click', () => {
    if (game) { game.destroy(); game = null }
    $('end-screen').classList.add('hidden')
    $('menu-screen').classList.remove('hidden')
    buildMenu()
  })

  // 兑换
  bindRedeem(() => {
    buildMenu()
  })

  // 下一波按钮（HUD 长按提示：按空格开始下一波）——加一个临时小按钮更直观
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

  // 每帧更新下一波按钮可见性
  setInterval(() => {
    nextBtn.style.display =
      game && game.waveState === 'idle' && !game.gameOver && game.wave > 0 ? 'block' : 'none'
  }, 200)
}

// ===== 初始化 =====
bindUI()
buildMenu()
