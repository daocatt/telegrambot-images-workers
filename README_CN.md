# SnapFlare — Telegram 机器人图床管理系统

SnapFlare 是一个现代、轻量、完全无服务器的图床系统。它基于 Cloudflare 边缘计算（Workers）和 D1 数据库，以您的私有 Telegram 频道作为图片存储介质，为您提供完全免费、低延迟、零维护开销的私人云图床服务。

---

## 🌟 主要功能

- **机器人自动存图**：直接向 Telegram 机器人发送图片（或批量相册），机器人将自动把图片转发保存至您的私有频道，并秒回专属的永久 Web 分享链接。
- **直角黑白极简后台**：提供独立且美观的 Web 管理面板。非管理员用户仅能查看与切换自己图片的公开性；超级管理员可全局管理所有用户、图片及相册。
- **安全双通道验证**：通过 Bot 发送 `/dashboard` 登录时，系统将发放一个有效期 5 分钟的单次 ticket，并向您的 Telegram 私信独立下发 6 位随机数字验证码。只有在网页输入匹配的验证码才能成功登录，防止登录链接被拦截劫持。
- **密码保护相册（画廊）**：支持将多张图片归类到画廊中，支持选择不同的自适应布局（网格、瀑布流、幻灯片），并可设置 6 位相册访问密码。
- **数据级联删除**：在 Web 管理页面彻底删除图片记录时，系统会通过 Webhook 异步自动清除 Telegram 私有频道中的对应原图消息，省心省空间。
- **Cloudflare 安全防爬**：支持登录页一键可选集成 Cloudflare Turnstile 人机验证，防止机器暴力破解。
- **极速边缘缓存 (Edge Cache)**：集成 Cache API，高频图片直通边缘节点，实现 0 次数据库读取，接近 0 延迟。

---

## 🚀 部署指引

### 1. 配置环境变量 (`.env.pot`)
在本地创建 `.env.pot` 配置文件，包含以下参数：

| 变量名 | 说明 | 示例 |
|---|---|---|
| `BOT_TOKEN` | 您的 Telegram 机器人 Token（由 `@BotFather` 创建） | `8680123482:AAF...` |
| `CHANNEL_ID` | 您的私有 Telegram 频道数字 ID（Bot 需为管理员，ID 以 `-100` 开头） | `-1003457732740` |
| `ACCESS_MODE` | 访问模式：`single`（仅管理员可用）或 `multi`（多人家族模式） | `multi` |
| `REQUIRE_APPROVAL` | 新用户使用前是否需要管理员手动审批审核（`true` / `false`） | `true` |
| `ENABLE_GALLERY` | 是否开启画廊/相册分组功能（`true` / `false`） | `true` |
| `BASE_URL` | Worker 的主要 Web 服务域名 (末尾不要加 `/`) | `https://imgbox.p6p.app` |
| `SUPER_ADMIN_TG_ID` | 拥有超级管理员权限的 Telegram 账号数字 ID | `6162082575` |
| `TURNSTILE_SITE_KEY` | *(可选)* Cloudflare Turnstile 前端 SITE KEY | `0x4AAAAAA...` |
| `TURNSTILE_SECRET_KEY`| *(可选)* Cloudflare Turnstile 后端 SECRET KEY | `0x4AAAAAA...` |
| `RESEND_API_KEY` | *(可选)* 邮箱修改时的验证邮件发送 Resend API Key | `re_Nu86p...` |

### 2. 本地一键部署
```bash
# 1. 安装依赖
npm install

# 2. 生成本地 wrangler.jsonc (参考 wrangler.jsonc 确认绑定)
# 3. 执行迁移并部署 (deploy-pot.sh 会自动读取 .env.pot 参数并以 Secret 形式上传至 Cloudflare)
bash deploy-pot.sh

# 4. 激活 Webhook
# 部署成功后，在浏览器访问：
https://your-domain.app/setWebhook?admin_secret=<你的WEBHOOK_SECRET>
```

---

## 🤖 机器人内置指令

您可以通过 `@BotFather` 的 `/setcommands` 将以下指令录入您的机器人：
- `start` - 绑定当前 Telegram 账户并设置邮箱密码
- `help` - 显示项目基本信息及命令列表
- `me` - 查看个人资料、绑定邮箱状态及上传统计
- `upload` - 提示并指引上传图片
- `dashboard` - 安全获取 5 分钟有效的 Web 管理后台登录页面及 6 位数字验证码
- `pending` - *(管理员)* 列出当前所有等待审批的待激活用户
- `approve` - *(管理员)* 审批激活待加入用户：`/approve <TG ID>`
- `ban` - *(管理员)* 封禁阻断某位用户：`/ban <TG ID>`

---

## 📄 开源许可证

本项目基于 MIT License 协议开源。
