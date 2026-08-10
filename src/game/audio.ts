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
}

export function isMusicOn() { return musicOn }
export function isSfxOn() { return sfxOn }

export function setMusicOn(v: boolean) {
  musicOn = v
  if (musicGain) musicGain.gain.value = v ? 0.28 : 0
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

// ===== BGM：太空氛围循环 =====
const CHORD_PROG = [
  [130.8, 164.8, 196.0, 261.6], // Cm
  [155.6, 185.0, 233.1, 311.1], // Eb
  [110.0, 146.8, 164.8, 220.0], // F... 用 Ab/F
  [146.8, 174.6, 220.0, 293.7], // Bb
]
const ARP_NOTES = [261.6, 329.6, 392.0, 523.3, 659.3, 783.9]

let musicTimer: ReturnType<typeof setInterval> | null = null

function startMusic() {
  if (!ctx || !musicGain || !musicOn || musicTimer) return
  let step = 0
  const playChord = () => {
    if (!ctx || !musicGain) return
    const chord = CHORD_PROG[step % CHORD_PROG.length]
    const t = ctx.currentTime
    chord.forEach((f) => {
      const osc = ctx!.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = f
      const g = ctx!.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.06, t + 0.6)
      g.gain.linearRampToValueAtTime(0.0001, t + 3.6)
      osc.connect(g).connect(musicGain!)
      osc.start(t)
      osc.stop(t + 3.8)
    })
    // 旋律 arp（轻）
    const base = chord[0] * 2
    for (let i = 0; i < 4; i++) {
      const note = ARP_NOTES[(step * 4 + i) % ARP_NOTES.length]
      const t2 = t + i * 0.45
      const osc = ctx!.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = note
      const g = ctx!.createGain()
      g.gain.setValueAtTime(0.0001, t2)
      g.gain.linearRampToValueAtTime(0.035, t2 + 0.05)
      g.gain.linearRampToValueAtTime(0.0001, t2 + 0.4)
      osc.connect(g).connect(musicGain!)
      osc.start(t2)
      osc.stop(t2 + 0.45)
    }
    // 低频贝斯
    const bass = ctx!.createOscillator()
    bass.type = 'sine'
    bass.frequency.value = base
    const bg = ctx!.createGain()
    bg.gain.setValueAtTime(0.0001, t)
    bg.gain.linearRampToValueAtTime(0.05, t + 0.3)
    bg.gain.linearRampToValueAtTime(0.0001, t + 3.4)
    bass.connect(bg).connect(musicGain!)
    bass.start(t)
    bass.stop(t + 3.6)
    step++
  }
  playChord()
  musicTimer = setInterval(playChord, 3800)
}
