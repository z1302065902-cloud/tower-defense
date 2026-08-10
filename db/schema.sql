-- ============================================================
-- 爱发电（Afdian）订单履约表 · 通用模板
--
-- 玩家在爱发电购买「完整版 ¥8」后，webhook 记录已付款订单；
-- 玩家在游戏内输入订单号，由 api/afdian-verify 校验并授权解锁。
--
-- 用法：psql "$DATABASE_URL" -f db/schema.sql
-- 可重复执行（幂等）。
-- ============================================================

CREATE TABLE IF NOT EXISTS afdian_orders (
  out_trade_no TEXT PRIMARY KEY,          -- 爱发电订单号
  buyer_user_id TEXT,                     -- 购买者 user_id（可为空）
  plan_id TEXT,                           -- 方案 id（用于区分多款游戏/多方案）
  amount TEXT,                            -- 订单金额（字符串，爱发电原样）
  status INTEGER,                         -- 2 = 已付款
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 按方案查订单（审计/对账用）
CREATE INDEX IF NOT EXISTS idx_afdian_orders_plan
  ON afdian_orders (plan_id);
