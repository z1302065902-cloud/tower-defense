// 游戏引擎：Three.js 轨道塔防核心

import * as THREE from 'three'
import {
  TOWER_DEFS, ENEMY_DEFS, waveFor, basePosition,
  type MapDef, type TowerType, type EnemyType,
} from './data'
import { TOWER_MODEL_MAP, ENEMY_MODEL_MAP, spawnModel, preloadAll } from './assets'

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
  buffMul?: number // 增幅塔加成
}

export interface EnemyInstance {
  def: EnemyType
  hp: number
  maxHp: number
  shield: number // 护盾值（先吸收伤害）
  progress: number // 0..pathLen 沿路径位移
  speed: number
  slowT: number
  slowFactor: number
  reward: number
  damage: number
  mesh: THREE.Object3D
  dead: boolean
  hitFlash: number
  healT: number // healer 治疗计时
}

/** 局外科技加成 */
export interface GameModifiers {
  damageMul: number
  rateMul: number
  rangeMul: number
}

export interface GameEvents {
  onWaveChange: (wave: number) => void
  onCredits: (credits: number) => void
  onLives: (lives: number) => void
  onGameOver: (wave: number, kills: number) => void
  onVictory: (wave: number) => void // 达到地图波数上限
}

const PATH_COLOR = 0xC89A6A // 泥土小路（王国保卫战风格土路）

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
  mods: GameModifiers = { damageMul: 1, rateMul: 1, rangeMul: 1 }

  constructor(canvas: HTMLCanvasElement, map: MapDef, events: GameEvents, mods?: Partial<GameModifiers>) {
    this.map = map
    this.mods = { damageMul: 1, rateMul: 1, rangeMul: 1, ...mods }
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
    // 轻雾：柔和暖白雾
    this.scene.fog = new THREE.FogExp2(0xe8d8b8, 0.005)
    // 暖色田园天空背景
    this.buildNebulaBackground()

    // 温暖自然灯光（草原午后的阳光）
    const hemi = new THREE.HemisphereLight(0xfff4d8, 0xc8d8a8, 1.25)
    this.scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xfff0d0, 1.6)
    dir.position.set(10, 20, 8)
    dir.castShadow = true
    dir.shadow.mapSize.set(1024, 1024)
    this.scene.add(dir)
    // 补光：暖阳 + 淡绿草地反光
    const rimWarm = new THREE.PointLight(0xffd8a0, 0.5, 60)
    rimWarm.position.set(-14, 10, -12)
    this.scene.add(rimWarm)
    const rimGreen = new THREE.PointLight(0xa8d878, 0.4, 60)
    rimGreen.position.set(14, 8, 12)
    this.scene.add(rimGreen)

    // 动态星空背景（多层）
    this.buildStarfield()

    // 空间站漂浮装饰（背景氛围）
    this.buildSpaceDecor()

    // 地面 + 路径（彩色童趣渐变地面）
    const groundCanvas = document.createElement('canvas')
    groundCanvas.width = 512
    groundCanvas.height = 512
    const gctx = groundCanvas.getContext('2d')!
    const gg = gctx.createRadialGradient(256, 256, 50, 256, 256, 360)
    gg.addColorStop(0, '#8FC87F')
    gg.addColorStop(0.5, '#7BB868')
    gg.addColorStop(1, '#5A9A4A')
    gctx.fillStyle = gg
    gctx.fillRect(0, 0, 512, 512)
    // 草地纹理：深浅绿斑
    for (let i = 0; i < 300; i++) {
      const gx = Math.random() * 512, gy = Math.random() * 512
      gctx.fillStyle = Math.random() < 0.5
        ? `rgba(120,200,100,${0.08 + Math.random() * 0.12})`
        : `rgba(80,150,70,${0.08 + Math.random() * 0.12})`
      gctx.beginPath()
      gctx.arc(gx, gy, 1 + Math.random() * 2.5, 0, Math.PI * 2)
      gctx.fill()
    }
    // 小野花点缀（暖色）
    for (let i = 0; i < 40; i++) {
      gctx.fillStyle = `rgba(255,220,120,${0.5 + Math.random() * 0.3})`
      gctx.beginPath()
      gctx.arc(Math.random() * 512, Math.random() * 512, 1 + Math.random(), 0, Math.PI * 2)
      gctx.fill()
    }
    const groundTex = new THREE.CanvasTexture(groundCanvas)
    groundTex.colorSpace = THREE.SRGBColorSpace
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 44),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.85, metalness: 0.05 }),
    )
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.group.add(this.ground)

    // 路径生成
    this.buildPath()
    this.base = this.buildBase()
    this.group.add(this.base)

    // 网格辅助线（柔和暖白，融入草地）
    const grid = new THREE.GridHelper(44, 22, 0xF5E8C0, 0x6AA858)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.45
    this.group.add(grid)

    // 交互
    this.disposeFn = this.bindEvents(events)

    // 预加载真实模型（后台拉取，玩家放置时立即可用）
    preloadAll()

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

    // 用曲线沿路径放置圆盘，形成连续土路
    const curve = new THREE.CatmullRomCurve3(this.pathPoints)
    const discGeo = new THREE.CircleGeometry(1.35, 24)
    const mat = new THREE.MeshStandardMaterial({ color: PATH_COLOR, roughness: 0.85 })
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
    // 圆顶基地（珊瑚色主色）
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0xFF6F61, emissive: 0xFF6F61, emissiveIntensity: 0.45, roughness: 0.35 }),
    )
    dome.position.y = 0.6
    dome.castShadow = true
    g.add(dome)
    // 发光环（浅蓝副色）
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.0, 0.15, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x6EB5FF, emissive: 0x6EB5FF, emissiveIntensity: 0.6 }),
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.2
    g.add(ring)
    // 顶部小旗（金黄强调色）
    const flag = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 0.8, 4),
      new THREE.MeshStandardMaterial({ color: 0xFFC857, emissive: 0xFFC857, emissiveIntensity: 0.5 }),
    )
    flag.position.y = 2.0
    g.add(flag)
    return g
  }

  // 动画用数据
  private starParticles: THREE.Points | null = null
  private decorObjects: THREE.Object3D[] = []
  private explosionParticles: { mesh: THREE.Points; vel: THREE.Vector3[]; life: number }[] = []
  private nebulaBg: THREE.Mesh | null = null

  /**
   * 程序化星云天空背景：Canvas 生成深蓝紫渐变 + 彩色星云光斑 + 星星，
   * 作为场景背景（大球反向贴图），随相机移动，替换纯黑。
   */
  private buildNebulaBackground() {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    // 温暖田园天空（淡黄绿 → 奶白 → 暖橙晚霞，没有冷蓝）
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height)
    grad.addColorStop(0, '#FDF3D8')
    grad.addColorStop(0.4, '#FBF0D0')
    grad.addColorStop(0.7, '#FDE8C0')
    grad.addColorStop(1, '#F5D8A8')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 柔和暖色云霞光斑（奶黄、浅橙、淡绿、暖白）
    const blobs: { x: number; y: number; r: number; color: string; alpha: number }[] = [
      { x: 200, y: 130, r: 180, color: '255,235,190', alpha: 0.5 },   // 奶黄云
      { x: 500, y: 170, r: 190, color: '255,225,170', alpha: 0.45 },  // 淡橙云
      { x: 820, y: 140, r: 160, color: '255,245,220', alpha: 0.5 },   // 暖白云
      { x: 340, y: 360, r: 170, color: '210,230,170', alpha: 0.35 },  // 淡绿
      { x: 700, y: 380, r: 160, color: '255,215,160', alpha: 0.4 },   // 杏橙
      { x: 110, y: 430, r: 150, color: '255,205,150', alpha: 0.35 },  // 沙橙
    ]
    for (const b of blobs) {
      const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r)
      rg.addColorStop(0, `rgba(${b.color},${b.alpha})`)
      rg.addColorStop(0.5, `rgba(${b.color},${b.alpha * 0.5})`)
      rg.addColorStop(1, `rgba(${b.color},0)`)
      ctx.fillStyle = rg
      ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2)
    }

    // 暖白色小点（不是冷白星）
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * canvas.width
      const y = Math.random() * canvas.height
      const size = Math.random() < 0.8 ? 1.2 : 1.8
      const bright = 0.4 + Math.random() * 0.3
      ctx.fillStyle = `rgba(255,252,240,${bright})`
      ctx.beginPath()
      ctx.arc(x, y, size / 2, 0, Math.PI * 2)
      ctx.fill()
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    // 大球反向贴图（相机在里面，看到彩色星云）
    const bgGeo = new THREE.SphereGeometry(90, 32, 16)
    const bgMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
    const bg = new THREE.Mesh(bgGeo, bgMat)
    bg.position.set(0, 0, 0)
    bg.renderOrder = -1
    this.scene.add(bg)
    this.nebulaBg = bg
  }

  /** 多层动态星空：远近两层 + 缓慢旋转的星点 */
  private buildStarfield() {
    // 远层：稀疏小星
    const far = new THREE.BufferGeometry()
    const farPos: number[] = []
    for (let i = 0; i < 400; i++) {
      farPos.push(
        (Math.random() - 0.5) * 200,
        Math.random() * 60 + 5,
        (Math.random() - 0.5) * 200,
      )
    }
    far.setAttribute('position', new THREE.Float32BufferAttribute(farPos, 3))
    const farMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.6, sizeAttenuation: true })
    const farPts = new THREE.Points(far, farMat)
    this.scene.add(farPts)

    // 近层：彩色亮星（缓慢漂移）
    const near = new THREE.BufferGeometry()
    const nearPos: number[] = []
    const nearCol: number[] = []
    const colors = [0xfff4d8, 0xffd8a0, 0xffe8c0, 0xfffff0, 0xffc880]
    for (let i = 0; i < 150; i++) {
      nearPos.push((Math.random() - 0.5) * 180, Math.random() * 45 + 8, (Math.random() - 0.5) * 180)
      const c = new THREE.Color(colors[Math.floor(Math.random() * colors.length)])
      nearCol.push(c.r, c.g, c.b)
    }
    near.setAttribute('position', new THREE.Float32BufferAttribute(nearPos, 3))
    near.setAttribute('color', new THREE.Float32BufferAttribute(nearCol, 3))
    const nearMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.3, transparent: true, opacity: 0.9,
      sizeAttenuation: true, vertexColors: true,
    })
    const nearPts = new THREE.Points(near, nearMat)
    this.scene.add(nearPts)
    this.starParticles = nearPts
  }

  /** 漂浮的空间站模块作为背景装饰（远处小尺寸，缓慢旋转漂浮，不遮挡视角） */
  private buildSpaceDecor() {
    const names = ['corridor', 'room-small', 'room-large', 'gate']
    // 模型越大，基准缩放越小
    const sizeMul: Record<string, number> = {
      corridor: 0.45, 'room-small': 0.5, 'room-large': 0.32, gate: 0.45,
    }
    // 中等距离高空散布（半径 18-26，能看见但不挡画面）
    const positions: [number, number, number][] = [
      [-22, 16, -18], [24, 20, -14], [-20, 24, 6], [25, 14, 10],
      [2, 26, -22], [18, 22, -8], [-26, 18, 8], [14, 26, 12],
    ]
    names.forEach((n, i) => {
      const pos = positions[i % positions.length]
      void spawnModel(n, undefined, 'space').then((m) => {
        if (!m) return
        m.position.set(pos[0], pos[1], pos[2])
        const s = (sizeMul[n] ?? 0.4) * (0.9 + Math.random() * 0.3)
        m.scale.setScalar(s)
        m.rotation.y = Math.random() * Math.PI * 2
        // 关闭阴影 + 轻微自发光，让远处建筑在暗背景中显眼
        m.traverse((ch) => {
          if ((ch as THREE.Mesh).isMesh) {
            const mesh = ch as THREE.Mesh
            mesh.castShadow = false
            mesh.receiveShadow = false
            const mat = mesh.material as any
            if (mat && mat.emissive !== undefined) {
              mat.emissive = new THREE.Color(0x223355)
              mat.emissiveIntensity = 0.25
            }
          }
        })
        ;(m as any).userData = { spin: (Math.random() - 0.5) * 0.1, floatAmp: 0.3 + Math.random() * 0.3, floatSpeed: 0.25 + Math.random() * 0.35, baseY: pos[1] }
        this.decorObjects.push(m)
        this.scene.add(m)
      })
    })
  }

  /** 爆炸粒子特效 */
  private spawnExplosion(x: number, y: number, z: number, color: number) {
    const geo = new THREE.BufferGeometry()
    const count = 12
    const pos = new Float32Array(count * 3)
    const vel: THREE.Vector3[] = []
    for (let i = 0; i < count; i++) {
      pos[i * 3] = x
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = z
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3))
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({ color, size: 0.18, transparent: true, opacity: 1 })
    const pts = new THREE.Points(geo, mat)
    this.group.add(pts)
    this.explosionParticles.push({ mesh: pts, vel, life: 0.7 })
  }

  /** 更新动画：星空漂移、装饰漂浮旋转、爆炸粒子、敌人/塔动画 */
  private animate(dt: number) {
    const t = this.time
    // 星云背景缓慢旋转（跟随相机，制造空间流动感）
    if (this.nebulaBg) {
      this.nebulaBg.rotation.y += dt * 0.004
      this.nebulaBg.rotation.z += dt * 0.001
    }
    // 星空缓慢旋转
    if (this.starParticles) {
      this.starParticles.rotation.y += dt * 0.01
    }
    // 装饰漂浮旋转
    for (const d of this.decorObjects) {
      const u = (d as any).userData
      d.rotation.y += dt * u.spin
      d.position.y = u.baseY + Math.sin(t * u.floatSpeed) * u.floatAmp
    }
    // 爆炸粒子
    for (const ep of this.explosionParticles) {
      ep.life -= dt
      const posAttr = ep.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < ep.vel.length; i++) {
        ep.vel[i].y -= dt * 5
        posAttr.setXYZ(i,
          posAttr.getX(i) + ep.vel[i].x * dt,
          posAttr.getY(i) + ep.vel[i].y * dt,
          posAttr.getZ(i) + ep.vel[i].z * dt)
      }
      posAttr.needsUpdate = true
      ;(ep.mesh.material as THREE.PointsMaterial).opacity = Math.max(0, ep.life / 0.7)
      if (ep.life <= 0) ep.mesh.removeFromParent()
    }
    this.explosionParticles = this.explosionParticles.filter((e) => e.mesh.parent)
    // 敌人自旋动画
    for (const en of this.enemies) {
      en.mesh.rotation.y += dt * 0.6
    }
    // 塔炮台旋转瞄准（只转武器子节点，不转塔身）
    for (const tw of this.towers) {
      if (tw.target && !tw.target.dead) {
        const dir = Math.atan2(tw.target.mesh.position.z - tw.z, tw.target.mesh.position.x - tw.x)
        // 最后一个子节点是武器（挂载的 GLB）
        const weapon = tw.mesh.children[tw.mesh.children.length - 1]
        if (weapon) weapon.rotation.y = dir - Math.PI / 2
      }
    }
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
    } else if (type === 'slow' || type === 'frost') {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55 * s, 0.1, 8, 18),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: def.color, emissiveIntensity: 0.6 }),
      )
      ring.position.y = 1.1
      g.add(ring)
      // 冰霜塔加冰晶
      if (type === 'frost') {
        const crystal = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.35 * s, 0),
          new THREE.MeshStandardMaterial({ color: 0xd0f6ff, emissive: def.color, emissiveIntensity: 0.5 }),
        )
        crystal.position.y = 1.5
        g.add(crystal)
      }
    } else if (type === 'storm') {
      // 电击塔：顶部球形电核 + 尖刺
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.28 * s, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      )
      orb.position.y = 1.4
      g.add(orb)
      for (let i = 0; i < 4; i++) {
        const spike = new THREE.Mesh(
          new THREE.ConeGeometry(0.1, 0.35, 6),
          new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.7 }),
        )
        const a = (i / 4) * Math.PI * 2
        spike.position.set(Math.cos(a) * 0.45 * s, 1.15, Math.sin(a) * 0.45 * s)
        spike.rotation.x = -0.4
        spike.rotation.z = -a
        g.add(spike)
      }
    } else if (type === 'amp') {
      // 增幅塔：悬浮环 + 核心
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.4 * s, 0),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: def.color, emissiveIntensity: 0.8 }),
      )
      core.position.y = 1.15
      g.add(core)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.7 * s, 0.06, 8, 24),
        new THREE.MeshBasicMaterial({ color: def.color }),
      )
      ring.position.y = 1.5
      ring.rotation.x = Math.PI / 2
      g.add(ring)
    } else if (type === 'plasma') {
      // 等离子塔：大口径炮管
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.36, 1.0, 10),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: def.color, emissiveIntensity: 0.6 }),
      )
      barrel.position.y = 1.35
      g.add(barrel)
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
    // 护盾敌人加护盾环
    if (def.shield) {
      const shieldRing = new THREE.Mesh(
        new THREE.SphereGeometry(0.75 * def.scale, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x7fa8ff, transparent: true, opacity: 0.35, wireframe: true }),
      )
      g.add(shieldRing)
    }
    // 治疗敌人加十字标识
    if (def.healPerSec) {
      const cross = new THREE.Mesh(
        new THREE.BoxGeometry(0.55 * def.scale, 0.5 * def.scale, 0.12),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      )
      const cross2 = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.55 * def.scale, 0.12),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      )
      cross.position.y = 1.05 * def.scale
      cross2.position.y = 1.05 * def.scale
      g.add(cross)
      g.add(cross2)
    }
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
    // 升级后重新挂真实模型
    void this.mountTowerModel(t)
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
    // 异步换真实模型（失败保留几何体）
    void this.mountTowerModel(t)
    this.events.onCredits(this.credits)
    // 继续建造同类型（便于连放）
    this.updateGhost()
  }

  /** 异步把塔的几何体换成 Kenney 真实模型 */
  private async mountTowerModel(t: TowerInstance) {
    const map = TOWER_MODEL_MAP[t.def]
    if (!map) return
    const body = await spawnModel(map.body, TOWER_DEFS[t.def].color)
    if (!body) return
    // 移除旧几何体子节点（保留外壳 mesh 用于定位）
    while (t.mesh.children.length) t.mesh.remove(t.mesh.children[0])
    body.scale.setScalar(map.scale || 1)
    body.position.y = 0.55
    t.mesh.add(body)
    // 挂武器（若有）
    if (map.weapon) {
      const w = await spawnModel(map.weapon, TOWER_DEFS[t.def].color)
      if (w) {
        w.scale.setScalar((map.scale || 1) * 0.9)
        w.position.y = 1.5
        t.mesh.add(w)
      }
    }
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
    let dmg = '辅助'
    if (t.def === 'slow' || t.def === 'frost') dmg = '减速'
    else if (t.def === 'amp') dmg = `增幅 ×${(def.buffDamageMul! * Math.pow(def.upgradeMultiplier, t.level - 1)).toFixed(2)}`
    else if (def.damage) dmg = `${Math.round(def.damage * Math.pow(def.upgradeMultiplier, t.level - 1))} 伤害`
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
      // 治疗者：周期性给周围敌人回血
      const healDef = ENEMY_DEFS[en.def]
      if (healDef.healPerSec) {
        en.healT = (en.healT || 0) + dt
        if (en.healT >= 1) {
          en.healT = 0
          for (const other of this.enemies) {
            if (other === en || other.dead) continue
            if (other.mesh.position.distanceTo(en.mesh.position) <= 4) {
              other.hp = Math.min(other.maxHp, other.hp + healDef.healPerSec)
            }
          }
        }
      }
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
      en.mesh.position.set(pos.x, 0.4 + Math.sin(this.time * 2.2 + en.progress) * 0.1, pos.z)
      // 朝向
      const t2 = Math.min((en.progress + 0.8) / this.pathLen, 1)
      const pos2 = curve.getPointAt(t2)
      en.mesh.lookAt(pos2.x, en.mesh.position.y, pos2.z)
      // 减速视觉（复用材质避免每帧新建）
      const bodyMat = this.enemyBodyMaterial(en)
      if (bodyMat) {
        if (en.slowT > 0) bodyMat.color.setHex(0x3dd6d0)
        else bodyMat.color.setHex(ENEMY_DEFS[en.def].color)
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead)

    // 塔攻击
    const rangeMul = this.mods.rangeMul
    const rateMul = this.mods.rateMul
    for (const t of this.towers) {
      const def = TOWER_DEFS[t.def]
      t.cooldown -= dt
      if (t.flashT > 0) t.flashT -= dt
      const range = def.range * rangeMul
      // 减速/冰霜塔：持续范围减速
      if (t.def === 'slow' || t.def === 'frost') {
        for (const en of this.enemies) {
          if (Math.hypot(en.mesh.position.x - t.x, en.mesh.position.z - t.z) <= range) {
            if (en.slowT <= 0 || def.slowFactor! < en.slowFactor) en.slowFactor = def.slowFactor!
            en.slowT = Math.max(en.slowT, def.slowDuration!)
          }
        }
        continue
      }
      // 增幅塔：提升周围塔伤害（不攻击）
      if (t.def === 'amp') {
        for (const other of this.towers) {
          if (other === t || other.def === 'amp' || other.def === 'slow' || other.def === 'frost') continue
          if (Math.hypot(other.x - t.x, other.z - t.z) <= def.buffRange!) {
            other.buffMul = def.buffDamageMul! * Math.pow(def.upgradeMultiplier, t.level - 1)
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
        if (d <= range && en.progress > bestProg) {
          best = en
          bestProg = en.progress
        }
      }
      if (!best) continue
      t.target = best
      t.cooldown = 1 / (def.fireRate * rateMul)
      // 开火视觉
      t.flashT = 0.12
      const dmg = Math.round(def.damage * Math.pow(def.upgradeMultiplier, t.level - 1) * this.mods.damageMul * (t.buffMul || 1))
      if (t.def === 'missile') {
        this.projectiles.push({ mesh: this.makeProjectile(def.color, t.x, t.z), target: best, speed: 10, damage: dmg, type: 'missile', splash: def.splashRadius! })
      } else if (t.def === 'beam') {
        this.fireBeam(t, best, dmg)
      } else if (t.def === 'storm') {
        this.fireChain(t, best, dmg, def.chainCount!)
      } else if (t.def === 'plasma') {
        this.fireBeam(t, best, dmg, 0.18)
      } else {
        this.projectiles.push({ mesh: this.makeProjectile(def.color, t.x, t.z), target: best, speed: 14, damage: dmg, type: 'bullet', splash: 0 })
      }
    }
    // 重置未受增幅的塔
    for (const t of this.towers) {
      let buffed = false
      for (const a of this.towers) {
        if (a.def === 'amp' && Math.hypot(a.x - t.x, a.z - t.z) <= TOWER_DEFS.amp.buffRange!) {
          buffed = true
          break
        }
      }
      if (!buffed) t.buffMul = 1
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

  private fireBeam(t: TowerInstance, target: EnemyInstance, dmg: number, radius = 0.05) {
    const mat = new THREE.MeshBasicMaterial({
      color: TOWER_DEFS[t.def].color, transparent: true, opacity: 0.8,
    })
    const a = new THREE.Vector3(t.x, 1.1, t.z)
    const b = target.mesh.position.clone()
    const h = a.distanceTo(b)
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 6), mat)
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    mesh.position.y = 1.1
    mesh.lookAt(b)
    mesh.rotateX(Math.PI / 2)
    this.group.add(mesh)
    this.beams.push({ mesh, life: 0.12 })
    this.damageEnemy(target, dmg, 0)
  }

  /** 电击塔：闪电链弹射 */
  private fireChain(t: TowerInstance, first: EnemyInstance, dmg: number, chainCount: number) {
    const hit = new Set<EnemyInstance>([first])
    let current = first
    this.damageEnemy(first, dmg, 0)
    // 画闪电
    this.drawLightning(t.x, t.z, first.mesh.position.x, first.mesh.position.z)
    for (let i = 0; i < chainCount; i++) {
      let next: EnemyInstance | null = null
      let bestD = Infinity
      for (const en of this.enemies) {
        if (hit.has(en) || en.dead) continue
        const d = en.mesh.position.distanceTo(current.mesh.position)
        if (d < bestD && d <= 5) { bestD = d; next = en }
      }
      if (!next) break
      hit.add(next)
      this.damageEnemy(next, Math.round(dmg * 0.6), 0)
      this.drawLightning(current.mesh.position.x, current.mesh.position.z, next.mesh.position.x, next.mesh.position.z)
      current = next
    }
  }

  private drawLightning(x1: number, z1: number, x2: number, z2: number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf6ff5e, transparent: true, opacity: 0.9 })
    const a = new THREE.Vector3(x1, 1, z1)
    const b = new THREE.Vector3(x2, 1, z2)
    const h = a.distanceTo(b)
    if (h < 0.01) return
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, h, 5), mat)
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    mesh.lookAt(b)
    mesh.rotateX(Math.PI / 2)
    this.group.add(mesh)
    this.beams.push({ mesh, life: 0.1 })
  }

  private damageEnemy(en: EnemyInstance, dmg: number, splash: number) {
    if (en.dead) return
    // 护盾优先吸收
    if (en.shield > 0) {
      const absorbed = Math.min(en.shield, dmg)
      en.shield -= absorbed
      dmg -= absorbed
      en.hitFlash = 0.15
    }
    if (dmg > 0) {
      en.hp -= dmg
      en.hitFlash = 0.15
    }
    if (splash > 0) {
      // 溅射：伤害范围敌人
      for (const other of this.enemies) {
        if (other === en || other.dead) continue
        if (other.mesh.position.distanceTo(en.mesh.position) <= splash) {
          if (other.shield > 0) {
            const ab = Math.min(other.shield, dmg * 0.5)
            other.shield -= ab
            other.hp -= dmg * 0.5 - ab
          } else {
            other.hp -= dmg * 0.5
          }
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
    // 死亡爆炸粒子
    this.spawnExplosion(en.mesh.position.x, 1, en.mesh.position.z, ENEMY_DEFS[en.def].color)
    en.mesh.removeFromParent()
    // 分裂者：死后分裂
    const def = ENEMY_DEFS[en.def]
    if (def.splitInto) {
      for (let i = 0; i < (def.splitCount || 2); i++) {
        this.spawnSplitEnemy(def.splitInto, en.mesh.position.x, en.mesh.position.z)
      }
    }
  }

  private spawnSplitEnemy(type: EnemyType, x: number, z: number) {
    const def = ENEMY_DEFS[type]
    const mesh = this.enemyMesh(type)
    // 分裂的小怪从父位置附近生成，仍在轨道上
    mesh.position.set(x, 0.4, z)
    this.group.add(mesh)
    const hpScale = 1 + (this.wave - 1) * 0.22 + this.wave * this.wave * 0.015
    const hp = Math.round(def.hp * hpScale * 0.6) // 分裂体较弱
    this.enemies.push({
      def: type, hp, maxHp: hp, shield: def.shield ? Math.round(def.shield * hpScale * 0.6) : 0,
      progress: this.findNearestProgress(x, z), speed: def.speed,
      slowT: 0, slowFactor: 1, reward: def.reward, damage: def.damage,
      mesh, dead: false, hitFlash: 0, healT: 0,
    })
  }

  /** 找离某个世界坐标最近的路径进度 */
  private findNearestProgress(x: number, z: number): number {
    const curve = new THREE.CatmullRomCurve3(this.pathPoints)
    let bestT = 0
    let bestD = Infinity
    for (let i = 0; i <= 50; i++) {
      const t = i / 50
      const p = curve.getPointAt(t)
      const d = Math.hypot(p.x - x, p.z - z)
      if (d < bestD) { bestD = d; bestT = t }
    }
    return bestT * this.pathLen
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
    const shield = def.shield ? Math.round(def.shield * hpScale) : 0
    this.enemies.push({
      def: type, hp, maxHp: hp, shield, progress: 0, speed: def.speed,
      slowT: 0, slowFactor: 1, reward: def.reward, damage: def.damage,
      mesh, dead: false, hitFlash: 0, healT: 0,
    })
    // 异步换真实 UFO 模型
    void this.mountEnemyModel(mesh, type)
  }

  /** 异步把敌人几何体换成 Kenney UFO 模型 */
  private async mountEnemyModel(mesh: THREE.Object3D, type: EnemyType) {
    const map = ENEMY_MODEL_MAP[type]
    if (!map) return
    const model = await spawnModel(map.model, ENEMY_DEFS[type].color)
    if (!model) return
    // 移除旧几何体（保留外壳用于定位/朝向）
    while (mesh.children.length) mesh.remove(mesh.children[0])
    model.scale.setScalar(map.scale)
    model.position.y = 0
    mesh.add(model)
  }

  /** 找到敌人的第一个可染色材质（遍历模型层级） */
  private enemyBodyMaterial(en: EnemyInstance): THREE.MeshStandardMaterial | null {
    let found: THREE.MeshStandardMaterial | null = null
    en.mesh.traverse((child) => {
      if (found) return
      const mesh = child as THREE.Mesh
      if (mesh.isMesh && mesh.material) {
        const m = mesh.material as any
        if (m && 'color' in m) found = m
      }
    })
    return found
  }

  private updateFx(dt: number) {
    // 命中闪白
    for (const en of this.enemies) {
      if (en.hitFlash > 0) {
        en.hitFlash -= dt
        const bodyMat = this.enemyBodyMaterial(en)
        if (bodyMat) {
          bodyMat.emissiveIntensity = en.hitFlash > 0 ? 1.2 : 0.25
        }
      }
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(this.clock.getDelta() * this.speed, 0.1)
    this.time += dt
    this.animate(dt)
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
