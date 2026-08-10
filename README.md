# 轨道塔防 · 太空基地防御

3D 太空主题轨道塔防（Tower Defense）。Vite + TypeScript + Three.js 构建，部署 GitHub Pages。

## 玩法

- 敌舰沿轨道进攻基地，在轨道旁建造炮塔阻止它们。
- 4 种炮塔：**脉冲炮**（快速单目标）、**导弹塔**（范围溅射）、**光束塔**（高射速持续输出）、**减速塔**（范围减速）。
- 无限波次，每 5 波一个 Boss；波次越高敌人越强越多。
- 击杀得金币，金币建塔/升级/出售；漏怪扣生命，生命归零游戏结束。

## 商业模型

- 免费试玩：阿尔法哨站、贝塔防线 2 张图。
- 完整版 ¥8（爱发电）：解锁全部 5 张图（伽马迷宫 / 德尔塔星环 / 欧米茄终局）。
- 玩家在爱发电付款后拿到**订单号**，游戏内输入即自助解锁，无需联系作者。

## 架构

```
玩家 → 爱发电付款 → 拿到订单号 → 游戏内输入
                                    │
GitHub Pages 静态游戏 ──fetch──▶ Vercel /api/afdian-verify
                                  ├─ 1. 查 Supabase 已付款订单
                                  └─ 2. 未命中 → 反向调爱发电 API 核实 → 记库解锁
```

部署履约层来自 `publish-kit` 模板（api/、db/schema.sql、.github/workflows、.vercelignore、.env.example）。
完整从零到上线步骤见上一级 `publish-kit/README.md`。

## 本地开发

```bash
npm install
npm run dev     # http://localhost:5173/tower-defense/
npm run build   # 产出 dist/
```

## 部署（GitHub Pages + Vercel）

1. **建 GitHub 仓库**（如 `tower-defense`）→ push 本目录到 main。
   - 注意：`vite.config.ts` 里 `base: '/tower-defense/'` 必须与仓库名一致。
2. **建 Supabase 项目** → SQL Editor 跑 `db/schema.sql`。
3. **建 Vercel 项目** → 导入仓库 → 注入 env（见 `.env.example`）：
   `AFDIAN_USER_ID` / `AFDIAN_TOKEN` / `AFDIAN_PLAN_ID` / `DATABASE_URL`
4. **改 `.github/workflows/deploy.yml`** 里的 `VITE_AFDIAN_VERIFY_URL` 为你的 Vercel 域名。
5. GitHub → Settings → Pages → Source 选 **GitHub Actions**。
6. push 到 main，Actions 自动构建部署。

> 完整流程和故障排查见 `publish-kit/README.md`。
