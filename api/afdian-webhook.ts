/**
 * 爱发电（Afdian）Webhook 履约层（Vercel Serverless）· 通用模板。
 *
 * 职责：
 *  1. 校验爱发电签名（MD5(user_id + token + params)），未通过 → 4xx，让爱发电重试
 *  2. 识别「已付款」的完整版方案订单（plan_id 匹配 + status===2）
 *  3. 把订单确定性记入数据库（按 out_trade_no 幂等 upsert）
 *  4. 玩家随后在游戏内输入「爱发电订单号」，由 api/afdian-verify 校验并授权解锁
 *
 * 环境变量：
 *  - AFDIAN_USER_ID    : 爱发电 user_id
 *  - AFDIAN_TOKEN      : 爱发电开发者后台「生成」的 token（切勿泄露）
 *  - AFDIAN_PLAN_ID    : 完整版方案的 plan_id
 *  - DATABASE_URL      : Postgres 连接串（存已付款订单）
 *
 * 注意：webhook 真实负载结构以爱发电官方为准。首次部署后请点后台「发送测试」，
 * 若结构不符，按 console 打印的 rawBody 调整这里的解析。
 *
 * 已知限制：爱发电服务器在大陆，直连 Vercel 可能 SSL 失败导致 webhook 收不到。
 * 这是可接受的——verify 端点有「拉模式」兜底，玩家解锁不依赖 webhook。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHash } from 'crypto'
import { Pool } from 'pg'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

let pool: Pool | null = null
function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: requireEnv('DATABASE_URL') })
  return pool
}

/**
 * 幂等记录一笔已付款订单。返回 true=新增/更新成功。
 * 以 out_trade_no 为唯一键。
 */
async function upsertPaidOrder(p: Pool, order: any) {
  const outTradeNo = order?.out_trade_no
  if (!outTradeNo) throw new Error('order missing out_trade_no')
  const userId = order?.user_id ?? ''
  const planId = order?.plan_id ?? ''
  const amount = order?.total_amount ?? ''
  const status = Number(order?.status ?? 0)
  await p.query(
    `INSERT INTO afdian_orders (out_trade_no, buyer_user_id, plan_id, amount, status, created_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (out_trade_no) DO UPDATE SET
       status = EXCLUDED.status, updated_at = NOW()`,
    [outTradeNo, userId, planId, amount, status],
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ec: 405, em: 'Method not allowed' })
  }

  const rawBody = await new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })

  // 爱发电要求 webhook URL 返回 {"ec":200} 才认为成功。
  const ok = (extra: Record<string, unknown> = {}) => res.status(200).json({ ec: 200, em: '', ...extra })
  const fail = (code: number, em: string) => res.status(code).json({ ec: code, em })

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    // 发送测试时可能直接 POST 明文；记下来便于排查
    console.error('[afdian] non-json body', rawBody.slice(0, 500))
    return fail(400, 'bad json')
  }

  try {
    const userId = process.env.AFDIAN_USER_ID || body?.user_id || ''
    const token = process.env.AFDIAN_TOKEN
    const planId = process.env.AFDIAN_PLAN_ID

    // 订单对象可能在 data.order（爱发电标准载荷），也可能在最外层。
    const order: any =
      body?.data?.order ?? (body?.type === 'order' ? body?.data ?? body : null)

    // ---- 签名校验（爱发电规则：sign = MD5(user_id + token + params)）----
    if (token) {
      const sign = body?.sign ?? ''
      const params =
        typeof body?.params === 'string' ? body.params : JSON.stringify(body?.data ?? order ?? {})
      const expected = createHash('md5')
        .update(`${userId}${token}${params}`)
        .digest('hex')
      if (!sign || sign.toLowerCase() !== expected.toLowerCase()) {
        console.error('[afdian] sign mismatch', { sign, expected })
        return fail(400, 'bad sign')
      }
    } else {
      console.warn('[afdian] AFDIAN_TOKEN not set — skipping signature check (deploy before going live)')
    }

    const outTradeNo = order?.out_trade_no
    const orderStatus = Number(order?.status ?? 0)
    const orderPlanId = order?.plan_id ?? ''

    console.log('[afdian] order received', JSON.stringify(order).slice(0, 400))

    // 只处理「已付款」的方案订单（status===2 = 已支付）
    if (!outTradeNo) {
      console.warn('[afdian] no out_trade_no, ignoring')
      return ok()
    }
    if (orderStatus !== 2) {
      console.log(`[afdian] order ${outTradeNo} not paid (status=${orderStatus}), skip`)
      return ok()
    }
    if (planId && orderPlanId && orderPlanId !== planId) {
      console.log(`[afdian] order ${outTradeNo} is other plan (${orderPlanId}), skip`)
      return ok()
    }

    const p = getPool()
    await upsertPaidOrder(p, order)
    console.log(`[afdian] PAID order recorded ${outTradeNo} amount=${order?.total_amount}`)

    return ok({ paid: true })
  } catch (e) {
    console.error('[afdian] handler error', (e as Error).message)
    // 内部错误 → 非 200，让爱发电重试
    return fail(500, 'internal error')
  }
}
