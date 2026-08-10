// 兑换 UI：激活码 / 爱发电订单号 → 解锁完整版

import { AFDIAN_VERIFY_URL, unlockFullVersion } from './paid'

export function bindRedeem(onUnlocked: () => void): void {
  const input = document.getElementById('redeem-input') as HTMLInputElement | null
  const btn = document.getElementById('redeem-btn') as HTMLButtonElement | null
  const msg = document.getElementById('redeem-msg') as HTMLElement | null
  if (!input || !msg) return

  const doRedeem = async () => {
    const raw = input.value.trim()
    if (!raw) return
    msg.textContent = '验证中…'
    msg.className = 'redeem-msg'
    // 爱发电订单号 = 14 位以上纯数字 → 走服务端自助解锁
    const looksLikeAfdianOrder = /^\d{14,}$/.test(raw.replace(/[\s-]/g, ''))
    let ok = false
    if (looksLikeAfdianOrder) {
      try {
        const order = encodeURIComponent(raw.replace(/[\s-]/g, ''))
        const r = await fetch(`${AFDIAN_VERIFY_URL}?order=${order}`, { method: 'GET' })
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; em?: string }
        ok = Boolean(j.ok)
        if (!ok) {
          msg.textContent = j.em === 'order not paid' ? '订单未找到或未付款' : '验证失败，请稍后再试'
          msg.className = 'redeem-msg err'
        }
      } catch {
        msg.textContent = '网络错误，请稍后再试'
        msg.className = 'redeem-msg err'
      }
    } else {
      // 激活码分支（本游戏暂未启用激活码，预留）
      ok = false
      msg.textContent = '激活码无效'
      msg.className = 'redeem-msg err'
    }
    if (ok) {
      msg.textContent = '✓ 解锁成功！'
      msg.className = 'redeem-msg ok'
      input.value = ''
      unlockFullVersion()
      onUnlocked()
    }
  }

  btn?.addEventListener('click', (e) => {
    e.stopPropagation()
    void doRedeem()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doRedeem()
  })
}
