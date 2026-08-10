// 游戏引擎：Three.js 轨道塔防核心

import * as THREE from 'three'
import {
  TOWER_DEFS, ENEMY_DEFS, waveFor, basePosition,
  type MapDef, type TowerType, type EnemyType,
} from './data'

export interface TowerInstance {
  def: keyof typeof TOWER_DEFS
  x: number
  z: number
  level: number
  cooldown: number
  mesh: THREE.Object3D
  rangeMesh?: THREE.Mesh
  target?: EnemyInstance | null
  flashT: number
  invested: number
}

export interface EnemyInstance {
  def: EnemyType
  hp: number
  maxHp: number
  progress: number // 0..pathLen 沿路径位移
  speed: number
  slowT: number
  slowFactor: number
  reward: number
  damage: number
  mesh: THREE.Object3D
  dead: boolean
  hitFlash: number
}

export interface GameEvents {
  onWaveChange: (wave: number) => void
  onCredits: (credits: number) => void
  onLives: (lives: number) => void
  onGameOver: (wave: number, kills: number) => void
  onVictory: (wave: number) => void // 达到地图波数上限
}

const GROUND_COLOR = 0x0c1428
const PATH_COLOR = 0x1d2c52
const BASE_COLOR = 0x4fd1ff

export class TowerGame {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.PerspectiveCamera
  clock = new THREE.Clock()
  raycaster = new THREE.Raycaster()

  map: MapDef
  pathLen = 0
  pathPoints: THREE.Vector3[] = []

  towers: TowerInstance[] = []
  enemies: EnemyInstance[] = []
  projectiles: { mesh: THREE.Mesh; target: EnemyInstance; speed: number; damage: number; type: 'bullet' | 'missile'; splash: number; hit?: boolean }[] = []
  beams: { mesh: THREE.Mesh; life: number }[] = []

  credits: number
  lives: number
  wave = 0
  waveState: 'idle' | 'active' | 'won' | 'over' = 'idle'
  kills = 0
  gameOver = false
  speed = 1
  selectedTower: TowerInstance | null = null
  buildingType: TowerType | null = null

  ground: THREE.Mesh
  base: THREE.Group
  group = new THREE.Group()

  private raf = 0
  private disposeFn: () => void
  private time = 0
  private spawnQueue: { type: EnemyType; at: number }[] = []
  private spawnTimer = 0
  private waveEnded = false
  private buildingGhost: THREE.Mesh | null = null

  constructor(canvas: HTMLCanvasElement, map: MapDef, events: GameEvents) {
    this.map = map
    this.credits = map.startCredits
    this.lives = map.startLives

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200)
    this.camera.position.set(0, 26, 22)
    this.camera.lookAt(0, 0, 0)

    this.scene.add(this.group)
    this.scene.fog = new THREE.Fog(0x05070f, 40, 70)
    this.scene.background = new THREE.Color(0x05070f)

    // 灯光
    const hemi = new THREE.HemisphereLight(0x8899ff, 0x0c1428, 0.7)
    this.scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 1.1)
    dir.position.set(10, 20, 8)
    dir.castShadow = true
    this.scene.add(dir)

    // 星星背景
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 300 }, () => new THREE.Vector3(
          (Math.random() - 0.5) * 160, Math.random() * 40 + 5, (Math.random() - 0.5) * 160,
        )),
      ),
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.7 }),
    )
    this.scene.add(stars)

    // 地面 + 路径
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 0.95 }),
    )
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.group.add(this.ground)

    // 路径生成
    this.buildPath()
    this.base = this.buildBase()
    this.group.add(this.base)

    // 网格辅助线（可选放置辅助）
    const grid = new THREE.GridHelper(40, 20, 0x223055, 0x141f3d)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.35
    this.group.add(grid)

    // 交互
    this.disposeFn = this.bindEvents(events)

    // 开始循环
    this.loop()
  }

  private buildPath() {
    const pts = this.map.path
    this.pathPoints = pts.map(([x, z]) => new THREE.Vector3(x, 0.02, z))
    // 路径长度
    let len = 0
    for (let i = 1; i < this.pathPoints.length; i++) {
      len += this.pathPoints[i].distanceTo(this.pathPoints[i - 1])
    }
    this.pathLen = len

    // 用曲线沿路径放置圆盘，形成连续路径
    const curve = new THREE.CatmullRomCurve3(this.pathPoints)
    const discGeo = new THREE.CircleGeometry(1.3, 24)
    const mat = new THREE.MeshStandardMaterial({ color: PATH_COLOR, roughness: 0.9 })
    const samples = 60
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const p = curve.getPoint(t)
      const d = new THREE.Mesh(discGeo, mat)
      d.rotation.x = -Math.PI / 2
      d.position.set(p.x, 0.01, p.z)
      d.receiveShadow = true
      this.group.add(d)
    }
  }

  private buildBase(): THREE.Group {
    const g = new THREE.Group()
    const [bx, bz] = basePosition(this.map)
    g.position.set(bx, 0.6, bz)
    // 圆顶基地
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 20, 14),
      new THREE.MeshStandardMaterial({ color: BASE_COLOR, emissive: 0x2a7fbf, emissiveIntensity: 0.4, roughness: 0.4 }),
    )
    dome.position.y = 0.6
    dome.castShadow = true
    g.add(dome)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.0, 0.15, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x4fd1ff, emissiveIntensity: 0.6 }),
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.2
    g.add(ring)
    return g
  }

  private towerMesh(type: TowerType, level = 1): THREE.Object3D {
    const def = TOWER_DEFS[type]
    const s = 0.9 + (level - 1) * 0.15
    const g = new THREE.Group()
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55 * s, 0.7 * s, 0.6, 16),
      new THREE.MeshStandardMaterial({ color: 0x22304f, roughness: 0.7 }),
    )
    base.position.y = 0.3
    base.castShadow = true
    g.add(base)
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.5 * s, 14, 12),
      new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.35, roughness: 0.4 }),
    )
    body.position.y = 0.9
    body.castShadow = true
    g.add(body)
    // 炮管/光束指示器
    if (type === 'beam') {
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: def.color, emissiveIntensity: 0.8 }),
      )
      barrel.position.y = 1.3
      g.add(barrel)
    } else if (type === 'missile') {
      const top = new THREE.Mesh(
        new THREE.ConeGeometry(0.4 * s, 0.5, 12),
        new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.3 }),
      )
      top.position.y = 1.3
      g.add(top)
    } else if (type === 'slow') {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55 * s, 0.1, 8, 18),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: def.color, emissiveIntensity: 0.6 }),
      )
      ring.position.y = 1.1
      g.add(ring)
    } else {
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8),
        new THREE.MeshStandardMaterial({ color: 0xddddff, roughness: 0.3 }),
      )
      barrel.position.y = 1.2
      g.add(barrel)
    }
    return g
  }

  private enemyMesh(type: EnemyType): THREE.Object3D {
    const def = ENEMY_DEFS[type]
    const g = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.7 * def.scale, 0.35 * def.scale, 1.1 * def.scale),
      new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.25, roughness: 0.5 }),
    )
    g.add(body)
    // 引擎光
    const glow = new THREE.Mesh(
      new THREE.ConeGeometry(0.18 * def.scale, 0.3, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    )
    glow.rotation.x = Math.PI / 2
    glow.position.z = -0.7 * def.scale
    g.add(glow)
    return g
  }

  // ===== 公共 API =====

  startWave() {
    if (this.waveState === 'active' || this.gameOver) return
    this.wave++
    const wave = waveFor(this.map, this.wave)
    // 生成生成队列
    this.spawnQueue = []
    let t = 0
    for (const s of wave.spawns) {
      for (let i = 0; i < s.count; i++) {
        this.spawnQueue.push({ type: s.type, at: t + Math.random() * wave.interval })
        t += wave.interval
      }
    }
    // 队列按时间排序
    this.spawnQueue.sort((a, b) => a.at - b.at)
    this.spawnTimer = 0
    this.waveEnded = false
    this.waveState = 'active'
    this.events.onWaveChange(this.wave)
  }

  build(type: TowerType) {
    this.buildingType = type
    this.selectedTower = null
    this.hidePanel()
    this.updateGhost()
  }

  selectTower(t: TowerInstance | null) {
    this.selectedTower = t
    this.buildingType = null
    this.updateGhost()
    if (t) this.showPanel(t)
    else this.hidePanel()
  }

  setSpeed(s: number) { this.speed = s }

  upgradeCost(t: TowerInstance): number {
    const def = TOWER_DEFS[t.def]
    return Math.round(def.cost * Math.pow(def.upgradeMultiplier, t.level - 1))
  }

  sellValue(t: TowerInstance): number {
    return Math.round(t.invested * 0.7)
  }

  upgradeSelected() {
    const t = this.selectedTower
    if (!t) return
    const def = TOWER_DEFS[t.def]
    if (t.level >= def.maxLevel) return
    const cost = this.upgradeCost(t)
    if (this.credits < cost) return
    this.credits -= cost
    t.invested += cost
    t.level++
    // 重建网格
    t.mesh.removeFromParent()
    t.mesh = this.towerMesh(t.def, t.level)
    t.mesh.position.set(t.x, 0, t.z)
    this.group.add(t.mesh)
    this.showPanel(t)
    this.events.onCredits(this.credits)
  }

  sellSelected() {
    const t = this.selectedTower
    if (!t) return
    const val = this.sellValue(t)
    this.credits += val
    this.towers = this.towers.filter((x) => x !== t)
    t.mesh.removeFromParent()
    if (t.rangeMesh) t.rangeMesh.removeFromParent()
    this.selectTower(null)
    this.events.onCredits(this.credits)
  }

  /** 手动测试：往基地加钱（调试用） */
  addCredits(n: number) { this.credits += n; this.events.onCredits(this.credits) }

  // ===== 内部 =====

  private events!: GameEvents
  private bindEvents(events: GameEvents) {
    this.events = events
    const canvas = this.renderer.domElement
    const onDown = (e: PointerEvent) => this.handlePointer(e)
    const onMove = (e: PointerEvent) => this.handleHover(e)
    const onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    window.addEventListener('resize', onResize)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', onResize)
    }
  }

  private screenToGround(e: PointerEvent): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hits = this.raycaster.intersectObject(this.ground, false)
    if (!hits.length) return null
    const p = hits[0].point
    return new THREE.Vector3(p.x, 0, p.z)
  }

  private handlePointer(e: PointerEvent) {
    if (this.waveState === 'over' || this.waveState === 'won') return
    const p = this.screenToGround(e)
    if (!p) return
    // 如果正在建造
    if (this.buildingType) {
      this.tryPlace(this.buildingType, p)
      return
    }
    // 否则点击塔或空白
    const t = this.towerAt(p.x, p.z)
    if (t) {
      this.selectTower(t)
    } else {
      this.selectTower(null)
    }
  }

  private handleHover(e: PointerEvent) {
    if (!this.buildingType) return
    const p = this.screenToGround(e)
    if (!p) return
    if (!this.buildingGhost) return
    const ok = this.canPlace(this.buildingType, p.x, p.z)
    this.buildingGhost.position.set(p.x, 0.02, p.z)
    this.buildingGhost.visible = true
    ;(this.buildingGhost.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x4ade80 : 0xff5d5d)
  }

  private canPlace(type: TowerType, x: number, z: number): boolean {
    const def = TOWER_DEFS[type]
    if (this.credits < def.cost) return false
    // 不在路径上
    const minDistToPath = 1.7
    for (const d of this.pathPoints) {
      if (Math.hypot(d.x - x, d.z - z) < minDistToPath) return false
    }
    // 不与已有塔重叠
    for (const t of this.towers) {
      if (Math.hypot(t.x - x, t.z - z) < 1.5) return false
    }
    // 不建在基地上
    const [bx, bz] = basePosition(this.map)
    if (Math.hypot(bx - x, bz - z) < 2.2) return false
    return true
  }

  private towerAt(x: number, z: number): TowerInstance | null {
    for (const t of this.towers) {
      if (Math.hypot(t.x - x, t.z - z) < 1.0) return t
    }
    return null
  }

  private tryPlace(type: TowerType, p: THREE.Vector3) {
    if (!this.canPlace(type, p.x, p.z)) return
    const def = TOWER_DEFS[type]
    this.credits -= def.cost
    const mesh = this.towerMesh(type, 1)
    mesh.position.set(p.x, 0, p.z)
    this.group.add(mesh)
    const t: TowerInstance = {
      def: type, x: p.x, z: p.z, level: 1, cooldown: 0, mesh, invested: def.cost, flashT: 0,
    }
    this.towers.push(t)
    this.events.onCredits(this.credits)
    // 继续建造同类型（便于连放）
    this.updateGhost()
  }

  private updateGhost() {
    if (this.buildingGhost) {
      this.buildingGhost.removeFromParent()
      this.buildingGhost = null
    }
    if (this.buildingType) {
      const g = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.8, 0.4, 20),
        new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.5 }),
      )
      g.rotation.x = 0
      g.position.y = 0.02
      g.visible = false
      this.group.add(g)
      this.buildingGhost = g
    }
  }

  showPanel(t: TowerInstance) {
    const def = TOWER_DEFS[t.def]
    const nameEl = document.getElementById('panel-name')!
    const infoEl = document.getElementById('panel-info')!
    const upEl = document.getElementById('btn-upgrade')! as HTMLButtonElement
    const upCostEl = document.getElementById('panel-upgrade-cost')!
    const sellEl = document.getElementById('panel-sell-value')!
    const panel = document.getElementById('tower-panel')!
    nameEl.textContent = `${def.name} Lv.${t.level}`
    const dmg = def.damage ? `${Math.round(def.damage * Math.pow(def.upgradeMultiplier, t.level - 1))} 伤害` : '减速'
    infoEl.textContent = `${dmg} · 射程 ${def.range}`
    const canUp = t.level < def.maxLevel && this.credits >= this.upgradeCost(t)
    upEl.disabled = !canUp
    if (t.level >= def.maxLevel) upCostEl.textContent = '满级'
    else upCostEl.textContent = String(this.upgradeCost(t))
    sellEl.textContent = String(this.sellValue(t))
    panel.classList.remove('hidden')
  }

  private hidePanel() {
    document.getElementById('tower-panel')!.classList.add('hidden')
  }

  private update(dt: number) {
    this.time += dt
    // 生成敌人
    if (this.waveState === 'active') {
      this.spawnTimer += dt
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.spawnTimer) {
        const s = this.spawnQueue.shift()!
        this.spawnEnemy(s.type)
      }
      // 判断波次是否结束
      if (this.spawnQueue.length === 0 && this.enemies.length === 0 && !this.waveEnded) {
        this.waveEnded = true
        this.waveState = 'idle'
        // 奖励
        this.credits += 25 + this.wave * 2
        this.events.onCredits(this.credits)
        // 检查胜利
        if (this.wave >= this.map.waves && !this.gameOver) {
          this.gameOver = true
          this.waveState = 'won'
          this.events.onVictory(this.wave)
        } else {
          this.events.onWaveChange(this.wave)
        }
      }
    }

    // 移动敌人
    const curve = new THREE.CatmullRomCurve3(this.pathPoints)
    for (const en of this.enemies) {
      let sp = en.speed
      if (en.slowT > 0) {
        en.slowT -= dt
        sp *= en.slowFactor
      }
      en.progress += sp * dt
      if (en.progress >= this.pathLen) {
        // 到达基地
        en.dead = true
        this.lives -= en.damage
        this.events.onLives(this.lives)
        en.mesh.removeFromParent()
        if (this.lives <= 0 && !this.gameOver) {
          this.gameOver = true
          this.waveState = 'over'
          this.events.onGameOver(this.wave, this.kills)
        }
        continue
      }
      const pos = curve.getPointAt(Math.min(en.progress / this.pathLen, 1))
      en.mesh.position.copy(pos)
      // 朝向
      const t2 = Math.min((en.progress + 0.8) / this.pathLen, 1)
      const pos2 = curve.getPointAt(t2)
      en.mesh.lookAt(pos2.x, en.mesh.position.y, pos2.z)
      // 减速视觉（复用材质避免每帧新建）
      const body = en.mesh.children[0] as THREE.Mesh
      const bodyMat = body.material as THREE.MeshStandardMaterial
      if (en.slowT > 0) bodyMat.color.setHex(0x3dd6d0)
      else bodyMat.color.setHex(ENEMY_DEFS[en.def].color)
    }
    this.enemies = this.enemies.filter((e) => !e.dead)

    // 塔攻击
    for (const t of this.towers) {
      const def = TOWER_DEFS[t.def]
      t.cooldown -= dt
      if (t.flashT > 0) t.flashT -= dt
      // 减速塔：持续范围减速
      if (t.def === 'slow') {
        for (const en of this.enemies) {
          if (Math.hypot(en.mesh.position.x - t.x, en.mesh.position.z - t.z) <= def.range) {
            en.slowT = def.slowDuration!
            en.slowFactor = def.slowFactor!
          }
        }
        continue
      }
      if (t.cooldown > 0) continue
      // 找目标：射程内最靠前的敌人
      let best: EnemyInstance | null = null
      let bestProg = -1
      for (const en of this.enemies) {
        const d = Math.hypot(en.mesh.position.x - t.x, en.mesh.position.z - t.z)
        if (d <= def.range && en.progress > bestProg) {
          best = en
          bestProg = en.progress
        }
      }
      if (!best) continue
      t.target = best
      t.cooldown = 1 / def.fireRate
      // 开火视觉
      t.flashT = 0.12
      const dmg = Math.round(def.damage * Math.pow(def.upgradeMultiplier, t.level - 1))
      if (t.def === 'missile') {
        this.projectiles.push({ mesh: this.makeProjectile(def.color, t.x, t.z), target: best, speed: 10, damage: dmg, type: 'missile', splash: def.splashRadius! })
      } else if (t.def === 'beam') {
        this.fireBeam(t, best, dmg)
      } else {
        this.projectiles.push({ mesh: this.makeProjectile(def.color, t.x, t.z), target: best, speed: 14, damage: dmg, type: 'bullet', splash: 0 })
      }
    }

    // 弹体更新
    for (const pr of this.projectiles) {
      const targetPos = pr.target.mesh.position
      const dir = targetPos.clone().sub(pr.mesh.position)
      const dist = dir.length()
      if (dist < 0.4) {
        // 命中
        this.damageEnemy(pr.target, pr.damage, pr.splash)
        pr.mesh.removeFromParent()
        pr.hit = true
      } else {
        const move = pr.speed * dt
        if (move >= dist) {
          pr.mesh.position.copy(targetPos)
        } else {
          pr.mesh.position.add(dir.normalize().multiplyScalar(move))
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.hit)

    // 光束更新
    for (const b of this.beams) {
      b.life -= dt
      if (b.life <= 0) b.mesh.removeFromParent()
    }
    this.beams = this.beams.filter((b) => b.life > 0 && b.mesh.parent)

    // 特效
    this.updateFx(dt)
  }

  private makeProjectile(color: number, x: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshBasicMaterial({ color }),
    )
    m.position.set(x, 1, z)
    this.group.add(m)
    return m
  }

  private fireBeam(t: TowerInstance, target: EnemyInstance, dmg: number) {
    const mat = new THREE.MeshBasicMaterial({
      color: TOWER_DEFS[t.def].color, transparent: true, opacity: 0.8,
    })
    const a = new THREE.Vector3(t.x, 1.1, t.z)
    const b = target.mesh.position.clone()
    const h = a.distanceTo(b)
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 6), mat)
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    mesh.position.y = 1.1
    mesh.lookAt(b)
    mesh.rotateX(Math.PI / 2)
    this.group.add(mesh)
    this.beams.push({ mesh, life: 0.12 })
    this.damageEnemy(target, dmg, 0)
  }

  private damageEnemy(en: EnemyInstance, dmg: number, splash: number) {
    if (en.dead) return
    en.hp -= dmg
    en.hitFlash = 0.15
    if (splash > 0) {
      // 溅射：伤害范围敌人
      for (const other of this.enemies) {
        if (other === en || other.dead) continue
        if (other.mesh.position.distanceTo(en.mesh.position) <= splash) {
          other.hp -= dmg * 0.5
          other.hitFlash = 0.15
        }
      }
    }
    if (en.hp <= 0) this.killEnemy(en)
  }

  private killEnemy(en: EnemyInstance) {
    en.dead = true
    this.kills++
    this.credits += en.reward
    this.events.onCredits(this.credits)
    en.mesh.removeFromParent()
  }

  private spawnEnemy(type: EnemyType) {
    const def = ENEMY_DEFS[type]
    const mesh = this.enemyMesh(type)
    const start = this.pathPoints[0]
    mesh.position.set(start.x, 0.4, start.z)
    this.group.add(mesh)
    // 波次成长：HP 随波次放大
    const hpScale = 1 + (this.wave - 1) * 0.22 + this.wave * this.wave * 0.015
    const hp = Math.round(def.hp * hpScale)
    this.enemies.push({
      def: type, hp, maxHp: hp, progress: 0, speed: def.speed,
      slowT: 0, slowFactor: 1, reward: def.reward, damage: def.damage,
      mesh, dead: false, hitFlash: 0,
    })
  }

  private updateFx(dt: number) {
    // 命中闪白
    for (const en of this.enemies) {
      if (en.hitFlash > 0) {
        en.hitFlash -= dt
        const body = en.mesh.children[0] as THREE.Mesh
        if (en.hitFlash > 0) (body.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2
        else (body.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25
      }
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta() * this.speed, 0.1)
    if (!this.gameOver) this.update(dt)
    else this.updateFx(dt)
    this.renderer.render(this.scene, this.camera)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.disposeFn()
    this.renderer.dispose()
  }
}
