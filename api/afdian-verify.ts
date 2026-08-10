/**
 * 爱发电订单自助解锁验证（Vercel Serverless）· 通用模板。
 *
 * 玩家在爱发电付款后得到「订单号」，在游戏内输入。
 * 本端点判断该订单是否已付款，若已付款则授权解锁完整版。
 *
 * 两条校验路径（提高可靠性）：
 *  1. 先查本地数据库 afdian_orders（webhook 已记录的已付款订单）→ 命中即解锁。
 *  2. 未命中 → 主动调用爱发电 query-order API（按 out_trade_no 查询真实订单）
 *     → 若 status===2（已支付）且 plan_id 匹配 → 记入本地库并解锁。
 *
 * 为什么需要路径 2：爱发电服务器在中国大陆，从大陆直连 Vercel 边缘节点可能
 * SSL/网络失败，webhook 推送可能收不到。而本端点跑在 Vercel（大陆以外），
 * 可以反向调用爱发电 API，主动核实订单状态，让自助解锁不依赖 webhook。
 *
 * 请求：GET/POST /api/afdian-verify?order=OUT_TRADE_NO
 * 响应：{ "ok": true }  → 已付款，可解锁
 *       { "ok": false, "em": "..." } → 未找到/未付款
 *
 * 环境变量：
 *  - DATABASE_URL
 *  - AFDIAN_USER_ID / AFDIAN_TOKEN（调用爱发电 API 核实订单时使用）
 *  - AFDIAN_PLAN_ID（仅解锁匹配方案，可选，缺省不校验）
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash } from 'crypto'
import { Pool } from 'pg'

let pool: Pool | null = null
function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL || '' })
  return pool
}

/**
 * 游戏部署在 GitHub Pages（跨域），前端用 fetch 调本端点。
 * 不加 CORS 头浏览器会拦截请求，自助解锁会失败。
 * 该端点只返回某订单是否已付款（public 只读信息），允许任意来源。
 */
function allowCors(res: VercelResponse): VercelResponse {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  return res
}

/** 是否本地库里已有该已付款订单。 */
async function checkLocalDb(order: string): Promise<boolean> {
  try {
    const p = getPool()
    const r = await p.query(
      `SELECT status FROM afdian_orders WHERE out_trade_no = $1 LIMIT 1`,
      [order],
    )
    const row = r.rows[0]
    return Boolean(row && Number(row.status) === 2)
  } catch (e) {
    console.error('[afdian-verify] db check error', (e as Error).message)
    return false // DB 不可用时不阻塞，继续走 Afdian API
  }
}

/**
 * 主动调用爱发电 query-order API 核实订单是否已付款。
 * 签名：sign = MD5(`${token}params${params}ts${ts}user_id${userId}`)
 * 返回 true=该订单已付款且（如配置了 AFDIAN_PLAN_ID）方案匹配。
 */
async function checkAfdianApi(order: string): Promise<{ paid: boolean; planId?: string; amount?: string }> {
  const userId = process.env.AFDIAN_USER_ID
  const token = process.env.AFDIAN_TOKEN
  if (!userId || !token) {
    console.error('[afdian-verify] AFDIAN_USER_ID/AFDIAN_TOKEN not set — cannot query Afdian')
    return { paid: false }
  }
  const params = JSON.stringify({ out_trade_no: order })
  const ts = Math.floor(Date.now() / 1000)
  const sign = createHash('md5').update(`${token}params${params}ts${ts}user_id${userId}`).digest('hex')

  const resp = await fetch('https://afdian.com/api/open/query-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, params, ts: String(ts), sign }),
  })
  const data = (await resp.json().catch(() => ({}))) as {
    ec?: number
    data?: { list?: any[] }
  }
  if (!resp.ok || data.ec !== 200 || !Array.isArray(data.data?.list)) {
    console.error('[afdian-verify] query-order failed', resp.status, JSON.stringify(data).slice(0, 300))
    return { paid: false }
  }
  // 精确匹配 out_trade_no
  const match = data.data.list.find((o) => String(o?.out_trade_no) === order)
  if (!match) return { paid: false }
  return {
    paid: Number(match?.status) === 2,
    planId: match?.plan_id ?? '',
    amount: match?.total_amount ?? '',
  }
}

/** 把已付款订单记入本地库（幂等），供快速查询 & 审计。 */
async function recordOrder(order: string, planId: string, amount: string) {
  try {
    const p = getPool()
    await p.query(
      `INSERT INTO afdian_orders (out_trade_no, buyer_user_id, plan_id, amount, status, created_at)
       VALUES ($1,'', $2, $3, 2, NOW())
       ON CONFLICT (out_trade_no) DO UPDATE SET
         status = 2, plan_id = EXCLUDED.plan_id, amount = EXCLUDED.amount, updated_at = NOW()`,
      [order, planId, amount],
    )
  } catch (e) {
    console.error('[afdian-verify] record error', (e as Error).message)
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return allowCors(res).status(204).end()
  }

  const order = String(req.query.order ?? '').trim()
  if (!order) {
    return allowCors(res).status(400).json({ ok: false, em: 'missing order' })
  }

  // 路径 1：本地库命中（webhook 已记录）
  if (await checkLocalDb(order)) {
    return allowCors(res).status(200).json({ ok: true })
  }

  // 路径 2：主动向爱发电核实
  try {
    const { paid, planId, amount } = await checkAfdianApi(order)
    if (!paid) {
      return allowCors(res).status(200).json({ ok: false, em: 'order not paid' })
    }
    const expectPlan = process.env.AFDIAN_PLAN_ID
    if (expectPlan && planId && planId !== expectPlan) {
      return allowCors(res).status(200).json({ ok: false, em: 'wrong plan' })
    }
    await recordOrder(order, planId, amount)
    return allowCors(res).status(200).json({ ok: true })
  } catch (e) {
    console.error('[afdian-verify] api check error', (e as Error).message)
    return allowCors(res).status(200).json({ ok: false, em: 'check failed' })
  }
}
