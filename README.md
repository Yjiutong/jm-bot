# jm-bot

QQ 官方群机器人：发一个禁漫 JM 号，机器人回一条**短期有效的在线试读链接**。

全部跑在 Cloudflare Workers 的**免费计划**上 —— 不需要服务器、不需要 Docker、不需要付费计划。

```
用户 @机器人 发 350234
   ↓
QQ 开放平台 --Webhook--> Worker /qq/callback   （Ed25519 校验签名）
   ↓
抓禁漫移动端 API（TypeScript 实现，响应体 AES-256-ECB 解密）
   ↓
元数据写入 R2，被动回复：标题 / 作者 / 标签 / 话数页数 + 试读链接
   ↓
浏览器打开 /p/350234?e=<过期时间>&s=<HMAC签名>
   ├─ 阅读页按话渲染，图片走 /i/... → R2 命中直接返回，未命中回源并落盘
   └─ 图片是横向切条乱序的，由页面内 Canvas 还原
```

## 为什么不是 Python / jmcomic

这个项目最初是照 [JMComic-Crawler-Python](https://github.com/hect0x7/JMComic-Crawler-Python) 改造的，接口层后来全部用 TypeScript 重写了，原因都是平台约束：

| 约束 | 后果 |
|---|---|
| Cloudflare Containers 是 **Paid 专属** | 免费计划只能用 Workers，Python 容器路线不成立 |
| 禁漫移动端 API 在 `www.cdnhjk.net` 这类独立域名上，**实测不吃 Cloudflare 反爬** | 不需要 `curl_cffi` 的浏览器指纹伪装，纯 `fetch` 就够 |
| Worker 运行时**没有 MD5**，WebCrypto 也**没有 AES-ECB** 模式 | 两者自行实现，见 `src/crypto.ts` |
| 免费档 **10ms CPU/请求** | 图片解码不能放服务端，改由浏览器 Canvas 还原切条 |

`src/crypto.ts` 里两个实现都有测试兜底：MD5 逐样本对齐 `node:crypto`，AES-ECB 用禁漫真实响应校验（173 个密文块，md5 与 Python 端一致）。CI 每次部署前都会跑 `node src/crypto.test.mjs`。

## 前置条件

- 一个 Cloudflare 账号（免费即可）
- **一个托管在 Cloudflare 的域名** —— 硬性要求：`*.workers.dev` 在中国大陆无法解析，QQ 的回调服务器也打不进来
- QQ 开放平台的机器人（AppID + AppSecret），建议先在沙箱联调（沙箱内不受频控）
- 一个 R2 桶，名字必须是 `jm-bot-cache`（与 `wrangler.jsonc` 的绑定名一致）

## 部署

### 方式 A：GitHub Actions（本仓库自带，推荐）

在仓库 `Settings → Secrets and variables → Actions` 里配好 5 个 secret：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 需要 Workers Scripts / R2 Storage 的 Edit 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 账户 ID |
| `QQ_APP_ID` | 机器人 AppID |
| `QQ_CLIENT_SECRET` | 机器人 AppSecret（同时用作 Ed25519 签名种子） |
| `LINK_SECRET` | 自定义随机串，用来签试读链接 |

之后 `git push` 到 `main` 即自动完成：类型检查 → 加密自检 → 建 R2 桶 → 同步 secret → 部署。

### 方式 B：Cloudflare Workers Builds

在 Cloudflare 后台直接把 Worker 连到这个仓库，好处是不用管 API Token。代价是 Actions 里的自动化都不会执行，你得**手动**建 R2 桶、手动配 secret，并且删掉 `.github/workflows/deploy.yml`，否则两边会抢部署。

### 部署完成后还要做三件事

1. 把变量 `PUBLIC_BASE_URL` 改成你的域名（例如 `https://jm.example.com`），并在 Worker 的 **Triggers → Custom domains** 绑定该域名（也可以直接解注释 `wrangler.jsonc` 里的 `routes`）。
2. 打开 `https://<你的域名>/cryptotest` 自检，确认运行时的 Ed25519 与 R2 写入都返回 `ok`。
3. 回 QQ 开放平台：回调地址填 `https://<你的域名>/qq/callback`，并把该域名加进**消息 URL 白名单**（上限 20 条、每年只能修改 50 次）—— 不加白名单，机器人回复里的链接点不开。

再给 R2 桶加一条生命周期规则：前缀 `albums/` 的对象 N 天后删除。这才是"短期链接"的物理过期，签名只是访问闸门。

## 路由

| 路径 | 作用 |
|---|---|
| `POST /qq/callback` | QQ 事件回调；处理 `op=13` 地址校验与 `op=0` 消息事件 |
| `GET /p/<JM号>?ep=<话序号>&e=&s=` | 阅读页，按话渲染 |
| `GET /i/<JM号>/<章节号>/<图片名>?e=&s=` | 图片，R2 缓存旁路 |
| `GET /cryptotest` | 运行时自检：Ed25519 签名/验签 + R2 读写 |
| `GET /` | 路由说明 |

## 配置项

`wrangler.jsonc` 的 `vars`（非密钥）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://REPLACE-ME.example.com` | **必须改**，机器人回复里的链接基址 |
| `PREVIEW_HOURS` | `24` | 试读链接有效小时数 |
| `QQ_API_BASE` | `https://api.bot.qq.com` | QQ REST 基址 |
| `QQ_TOKEN_URL` | `https://bots.qq.com/app/getAppAccessToken` | access_token 换取地址 |

Secrets：`QQ_APP_ID`、`QQ_CLIENT_SECRET`、`LINK_SECRET`。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入本地值
npm run dev                      # wrangler dev，默认 http://localhost:8787
npm run check                    # tsc --noEmit
node src/crypto.test.mjs         # 加密实现回归（ECB 用例需要本地样本，缺则跳过）
```

## 额度与限制

免费档：10 万请求/天、10ms CPU/请求、50 子请求/请求、128MB 内存。R2 免费额度：10GB 存储、100 万次写/月、1000 万次读/月，**出站流量不计费**。

- 一次完整试读约消耗 `1 + 该话页数` 个请求
- 章节是**按需抓取**的：打开哪话才抓哪话的图清单，所以百话长篇也不会撞上「50 子请求/请求」上限
- QQ 群聊被动回复窗口只有 **5 分钟、每条消息最多 5 次**，超时返回 `40034128`
- 群里必须 **@机器人** 才会收到 `GROUP_AT_MESSAGE_CREATE`；单聊事件是 `C2C_MESSAGE_CREATE`

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 打开链接 403 `链接已过期` / `签名不匹配` | 超过 `PREVIEW_HOURS`，或 `LINK_SECRET` 改过 |
| 机器人回 `抓取失败：禁漫接口全部失败` | 禁漫换了 API 域名。用 `probe/worker.js` 重新部署一次探针，看 `hosts` 里各域名的状态码，再更新 `src/jm.ts` 的 `API_HOSTS` |
| `/cryptotest` 里 `ed25519` 报 FAILED | 该运行时不支持 WebCrypto 的 Ed25519，需要换成纯 JS 实现 |
| QQ 后台回调地址校验不过 | 域名没解析到 Cloudflare、证书链不全，或腾讯侧探测延迟过高（社区经验约 500ms 以上会失败） |
| 回复里的链接不可点击 | 域名没加进 QQ 的消息 URL 白名单 |
| 部署报 `Error 1027` | 当天 10 万请求额度用完 |

`probe/worker.js` 是独立的出口连通性探针，单文件可直接粘进 Cloudflare 后台部署，访问 `/probe?album=<JM号>` 会逐项回报 cookie、专辑解密、scramble_id、封面四条链路。怀疑网络问题时先跑它。

## 免责声明

本项目仅为技术研究与个人学习用途。目标站点内容的版权归原权利人所有，其内容多为成人向，请遵守所在地的法律法规；QQ 开放平台的应用审核与运营规范同样适用，请勿用于分发、商用或公开传播。使用者自行承担全部风险与后果。

## 许可

MIT
