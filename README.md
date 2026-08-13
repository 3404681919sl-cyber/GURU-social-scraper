# GURU 社媒数据采集工作台（EdgeOne 版）

以原工作台 UI 为母版改造的 EdgeOne 原生全栈项目。前端仍使用 Next.js App Router；登录和跨设备数据使用 Supabase；真实采集通过 EdgeOne Agent Sandbox 的隔离 Chromium 完成。

## 已实现

- 保留原数据采集、看板、自动化配置三部分的响应式工作台设计
- 邮箱免密码登录与 GitHub OAuth（Supabase Auth）
- 用户级任务、快照和自动化数据隔离（Postgres + RLS）
- 用户在 Agent Browser 中自行登录小红书，工作台不接收密码或验证码
- 对账号主页或用户提供的 1–20 条小红书帖子链接进行渲染页采集
- 强制校验登录状态、canonical 原帖地址、错误页与必要字段；失败时不会生成成功任务
- 每条结果展示原始链接、采集时间、来源与校验状态
- Markdown、Excel（`.xlsx`）与 CSV 三种导出
- 真实数据看板；生产代码不包含 Mock 数据或静默降级

账号采集必须输入账号主页 URL，不接受名称猜测。项目不包含验证码绕过、Cookie 导入、反检测或其他规避平台控制的能力。自动化页面目前只保存配置，尚未接入定时执行器。

## 首次部署

### 1. 更新 GitHub 源码

使用本仓库内容完整替换旧版源码，不要只覆盖同名文件。确认仓库根目录不存在 `.vinext/`、`vite.config.*`、`wrangler.*`、`.openai/` 或旧的 `dist/`。

### 2. 初始化 Supabase 数据库

在 Supabase 新建项目后，在 SQL Editor 按顺序执行：

1. `supabase/migrations/0001_initial.sql`
2. `supabase/migrations/0002_snapshot_provenance.sql`

第二份迁移增加作者、正文、发布时间、标签、数据来源和校验状态。如果此前已经执行过 `0001_initial.sql`，只需补执行 `0002_snapshot_provenance.sql`。历史记录不会被自动标记为真实；看板只读取新链路写入且校验状态为 `verified` 的快照。

### 3. 配置 Supabase Authentication

在 Authentication → URL Configuration 设置：

- 临时使用 EdgeOne 默认域名测试：
  - Site URL：`https://你的项目.edgeone.cool`
  - Redirect URL：`https://你的项目.edgeone.cool/**`
- 绑定正式自定义域名后：
  - Site URL：`https://你的正式域名`
  - Redirect URL：`https://你的正式域名/auth/callback`

不要把 EdgeOne 预览链接中的 `eo_token` 或 `eo_time` 写进 Supabase。预览测试时应原样打开 EdgeOne 控制台生成的完整链接，再从页面内部进入登录页。

邮箱 Magic Link 默认可以直接使用。GitHub 登录是可选功能；只有启用 Supabase 的 GitHub Provider，并在 GitHub OAuth App 配好 Supabase 提供的 callback URL 后才可用。

### 4. 配置 EdgeOne 环境变量

在 EdgeOne 项目中配置以下变量，并让它们对生产和预览环境都生效：

| 变量名 | 变量值 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL，例如 `https://项目编号.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key（`sb_publishable_...`）或旧版 anon key |
| `NEXT_PUBLIC_SITE_URL` | 当前稳定站点根地址，不带路径、`eo_token` 或 `eo_time` |
| `SCRAPE_SIGNING_SECRET` | 至少 32 位的随机服务端密钥；Agent 用它签名采集结果，API 用它拒绝前端伪造数据 |

`SCRAPE_SIGNING_SECRET` 不得以 `NEXT_PUBLIC_` 开头，也不要提交到 Git。可在本机运行 `openssl rand -hex 32` 生成变量值，并让它对生产和预览环境都生效。不要填写 `sb_secret_...` 或 `service_role` key。修改任何环境变量后都应重新部署；`NEXT_PUBLIC_*` 值会在构建时写入浏览器代码。

### 5. 配置 EdgeOne 构建

项目根目录的 `edgeone.json` 已包含构建和 Agent 参数。控制台应确认：

| 项目 | 值 |
|---|---|
| 框架预设 | Next |
| 根目录 | `./` |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run build` |
| 输出目录 | `.next` |
| Node.js | 22.11 或兼容的 Node 22 |

Agent 配置为单次任务最多 1800 秒、Sandbox 会话最多 3600 秒。部署时不需要另外创建 Agent，也不需要配置 Cloudflare、Vite 或 Wrangler。

### 6. 重新部署与检查

清除旧构建缓存后重新部署。构建日志的 Next.js 路由表应包含 `/login`、`/auth/callback` 和 `/api/*`。EdgeOne 生成的预览链接约 3 小时有效；401 表示预览鉴权失效，404 才表示路由没有正确部署。

### 7. Agent Browser 授权窗口验收

部署后必须按以下顺序检查，任何一步失败都不要继续采集：

1. 点击“启动授权窗口”，页面应返回“打开登录窗口”。
2. 新窗口应显示 EdgeOne NoVNC 浏览器，而不是 `Site Unavailable`、401 或 404。
3. 在隔离浏览器中自行登录小红书，再回工作台点击“验证登录状态”。
4. 只有后端检测到登录证据后，“下一步”才会解锁。
5. 使用一条真实帖子链接采集，结果中的“核对原帖”必须能返回同一帖子；再用一条不存在的链接测试，任务必须失败。

如果第 2 步出现 `Site Unavailable`，前端和 Supabase 都无法修复它。这表示 EdgeOne 返回的 `browser.liveUrl` 当前不可访问。请到 EdgeOne 控制台检查本次部署的 Agent 日志与 Sandbox 状态；确认请求包含同一个 `Makers-Conversation-Id`、项目 `agents/` 路由已部署，并把时间、Agent 路由 `/scraper-session`、日志里的 sandbox 错误码提交给 EdgeOne 支持。不要把临时 `access_token` 发到聊天或工单公开区。

## 本地开发

```bash
cp .env.example .env.local
npm ci
npm run dev
```

本地 Next.js 服务器无法模拟 EdgeOne Agent Sandbox，因此授权浏览器入口需要在 EdgeOne 部署后测试。未启用 Agent Sandbox 时，真实采集会明确失败，不会回退到 Mock。

## 主要目录

- `app/`：Next.js 页面、Supabase 登录和后端 API
- `agents/scraper-session/`：EdgeOne Agent Browser 会话与采集端点
- `lib/supabase/`：SSR/浏览器 Supabase 客户端
- `supabase/migrations/`：Postgres 表、索引和 RLS 策略
- `edgeone.json`：EdgeOne 构建、函数和 Agent 配置

## 校验

```bash
npm run typecheck
npm run lint
npm run build
```
