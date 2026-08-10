// 程序化音频：太空氛围 BGM + 游戏音效（Web Audio，无外部文件）

let ctx: AudioContext | null = null
let master: GainNode | null = null
let musicGain: GainNode | null = null
let sfxGain: GainNode | null = null
let musicOn = true
let sfxOn = true

const MUTE_KEY = 'td-audio-v1'

function loadPrefs() {
  try {
    const raw = localStorage.getItem(MUTE_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      musicOn = p.music !== false
      sfxOn = p.sfx !== false
    }
  } catch { /* ignore */ }
}

export function initAudio() {
  loadPrefs()
  if (ctx) return
  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = 0.8
    master.connect(ctx.destination)
    musicGain = ctx.createGain()
    musicGain.gain.value = musicOn ? 0.28 : 0
    musicGain.connect(master)
    sfxGain = ctx.createGain()
    sfxGain.gain.value = sfxOn ? 0.5 : 0
    sfxGain.connect(master)
    startMusic()
  } catch { /* ignore */ }
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
  // 首次用户交互时确保 mp3 音乐开始（浏览器自动播放限制）
  if (musicOn && !musicEls.length) startMusic()
  else if (musicOn && musicEls.length) {
    musicEls.forEach((a) => { if (a.paused) void a.play().catch(() => {}) })
  }
}

export function isMusicOn() { return musicOn }
export function isSfxOn() { return sfxOn }

export function setMusicOn(v: boolean) {
  musicOn = v
  if (musicGain) musicGain.gain.value = v ? 0.28 : 0
  if (musicEls.length) {
    if (v) void musicEls[currentMusicIdx].play().catch(() => {})
    else musicEls.forEach((a) => a.pause())
  }
  savePrefs()
}
export function setSfxOn(v: boolean) {
  sfxOn = v
  if (sfxGain) sfxGain.gain.value = v ? 0.5 : 0
  savePrefs()
}
function savePrefs() {
  try {
    localStorage.setItem(MUTE_KEY, JSON.stringify({ music: musicOn, sfx: sfxOn }))
  } catch { /* ignore */ }
}

// ===== 音效 =====
function playTone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  if (!ctx || !sfxGain || !sfxOn) return
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(vol, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  osc.connect(g).connect(sfxGain)
  osc.start(t)
  osc.stop(t + dur)
}

export function sfxShoot() {
  playTone(880, 0.08, 'square', 0.12, 520)
}
export function sfxExplosion() {
  playTone(140, 0.3, 'sawtooth', 0.3, 40)
}
export function sfxPlace() {
  playTone(520, 0.12, 'triangle', 0.25, 780)
}
export function sfxUpgrade() {
  playTone(440, 0.1, 'triangle', 0.25, 660)
  setTimeout(() => playTone(660, 0.12, 'triangle', 0.25, 880), 90)
}
export function sfxSell() {
  playTone(600, 0.1, 'triangle', 0.2, 300)
}
export function sfxWave() {
  playTone(220, 0.4, 'sine', 0.3, 440)
}
export function sfxBoss() {
  playTone(110, 0.6, 'sawtooth', 0.35, 55)
}
export function sfxWin() {
  ;[523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.3, 'triangle', 0.3), i * 150))
}
export function sfxLose() {
  ;[330, 262, 196].forEach((f, i) => setTimeout(() => playTone(f, 0.4, 'sawtooth', 0.25), i * 200))
}

// ===== BGM：mp3 循环播放（吉卜力风战斗曲） =====
const BASE = (import.meta as any).env?.BASE_URL || '/'
const MUSIC_FILES = ['battle.mp3', 'battle2.mp3'] // 两首轮换循环

let musicEls: HTMLAudioElement[] = []
let currentMusicIdx = 0

function startMusic() {
  if (!musicOn || musicEls.length) return
  try {
    // 创建两个 Audio 元素，一首播完自动接下一首，循环轮换
    musicEls = MUSIC_FILES.map((f) => {
      const a = new Audio(`${BASE}assets/music/${f}`)
      a.loop = false
      a.volume = 0.45
      a.preload = 'auto'
      return a
    })
    const playNext = () => {
      const next = musicEls[currentMusicIdx]
      currentMusicIdx = (currentMusicIdx + 1) % musicEls.length
      if (musicOn) {
        void next.play().catch(() => {})
      }
    }
    // 每首播完（ended）自动播下一首 → 循环轮换
    musicEls.forEach((a) => a.addEventListener('ended', playNext))
    // 开始第一首
    void musicEls[0].play().catch(() => {})
  } catch {
    // mp3 不可用时静默（游戏不崩）
  }
}
