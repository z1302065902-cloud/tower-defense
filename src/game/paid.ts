// 付费解锁层：完整版状态 + 激活码 + 爱发电订单号自助解锁

const STORAGE_KEY = 'td-paid-v1'

export const TRIAL_MAPS = 2 // 试玩免费地图数

export const AFDIAN_VERIFY_URL: string =
  (import.meta as any).env?.VITE_AFDIAN_VERIFY_URL ||
  '/api/afdian-verify'

export function isFullVersion(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function unlockFullVersion(): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* ignore */
  }
  return true
}

/** 页面初始化时调用：加载后刷新 UI */
export function initPurchaseUI(refresh: () => void): void {
  refresh()
}
