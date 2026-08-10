// 3D 模型加载器：从 public/assets/kenney 加载 Kenney TD Kit 真实模型
// 失败时返回 null（调用方回退到程序化几何体）

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
const cache = new Map<string, Promise<THREE.Object3D | null>>()

// 模型路径前缀（GitHub Pages 子路径由 Vite base 处理）
const BASE = (import.meta as any).env?.BASE_URL || '/'

export function modelUrl(name: string): string {
  return `${BASE}assets/kenney/${name}.glb`
}

/**
 * 加载 GLB 模型，返回可复制的 Object3D（clone 后加入场景）。
 * 缓存 Promise，多个实例共享一次加载。
 * 失败返回 null（网络/资源不存在时优雅回退）。
 */
export function loadModel(name: string): Promise<THREE.Object3D | null> {
  const key = name
  const cached = cache.get(key)
  if (cached) return cached

  const p = new Promise<THREE.Object3D | null>((resolve) => {
    loader.load(
      modelUrl(name),
      (gltf) => resolve(gltf.scene),
      undefined,
      () => resolve(null), // 加载失败 → null
    )
  })
  cache.set(key, p)
  return p
}

// 塔类型 → Kenney 模型映射（主体 + 可选武器）
export const TOWER_MODEL_MAP: Record<string, { body: string; weapon?: string; scale?: number }> = {
  pulse:  { body: 'tower-round-build-a', weapon: 'weapon-turret', scale: 0.8 },
  missile: { body: 'tower-round-build-b', weapon: 'weapon-cannon', scale: 0.9 },
  beam:   { body: 'tower-round-build-c', weapon: 'weapon-ballista', scale: 0.9 },
  slow:   { body: 'tower-round-middle-a', scale: 0.85 },
  frost:  { body: 'tower-round-build-b', scale: 0.85 },
  storm:  { body: 'tower-square-build-a', weapon: 'weapon-turret', scale: 0.85 },
  amp:    { body: 'tower-square-bottom-a', scale: 0.9 },
  plasma: { body: 'tower-square-build-b', weapon: 'weapon-cannon', scale: 0.95 },
}

// 敌人类型 → Kenney 模型映射（scout/raider/tank/swarm/splitter/shielded/healer → UFO 系列, boss → 最大的）
export const ENEMY_MODEL_MAP: Record<string, { model: string; scale: number }> = {
  scout:   { model: 'enemy-ufo-a', scale: 0.6 },
  raider:  { model: 'enemy-ufo-b', scale: 0.8 },
  tank:    { model: 'enemy-ufo-c', scale: 1.1 },
  swarm:   { model: 'enemy-ufo-a', scale: 0.4 },
  boss:    { model: 'enemy-ufo-d', scale: 2.2 },
  splitter: { model: 'enemy-ufo-b', scale: 0.85 },
  shielded: { model: 'enemy-ufo-c', scale: 0.95 },
  healer:  { model: 'enemy-ufo-b', scale: 0.85 },
}

// 预加载清单（挂载时并行拉取，避免游戏中卡顿）
export const PRELOAD_MODELS: string[] = Array.from(new Set([
  ...Object.values(TOWER_MODEL_MAP).flatMap((m) => [m.body, m.weapon].filter(Boolean) as string[]),
  ...Object.values(ENEMY_MODEL_MAP).map((m) => m.model),
]))

export function preloadAll() {
  PRELOAD_MODELS.forEach((n) => void loadModel(n))
}

/** 给模型应用统一的材质参数（金属感/粗糙度/发光），让它融入场景 */
export function applyModelTint(obj: THREE.Object3D, color: number, emissiveIntensity = 0.2) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      const mat = mesh.material as any
      // Kenney 模型材质可能是 Standard/Lambert/Phong/Basic
      // 只有带 emissive 属性的材质才叠加发光（Standard/Phong）
      if (mat && mat.emissive !== undefined) {
        mat.emissive = new THREE.Color(color)
        mat.emissiveIntensity = emissiveIntensity
      } else if (mat && mat.color !== undefined && typeof mat.color === 'object') {
        // Lambert/Basic：轻微调亮颜色做阵营区分
        mat.color.lerp(new THREE.Color(color), 0.25)
      }
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })
  return obj
}

/** 获取模型并克隆 + 应用着色 */
export async function spawnModel(name: string, color?: number): Promise<THREE.Object3D | null> {
  const src = await loadModel(name)
  if (!src) return null
  const clone = src.clone(true)
  if (color !== undefined) applyModelTint(clone, color)
  return clone
}
