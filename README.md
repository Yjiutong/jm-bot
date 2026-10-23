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

## 职责划分

**GitHub 只放代码，配置全在 Cloudflare。** push 到 `main` 即自动构建部署；密钥和你的域名都不进仓库。

代码里所有可选项都有默认值，不需要为部署改任何一行：

- 链接基址：不设 `PUBLIC_BASE_URL` 时取回调请求自身的来源 —— 绑哪个域名就是哪个
- `PREVIEW_HOURS` 默认 24 小时
- `QQ_API_BASE` / `QQ_TOKEN_URL` 用官方生产地址

## 部署

### 前置

- Cloudflare 账号（免费即可）
- **一个托管在 Cloudflare 的域名**（硬性要求：`*.workers.dev` 在中国大陆无法解析，QQ 的回调服务器也打不进来）
- QQ 开放平台的机器人，拿到 AppID 与 AppSecret
- 一个 Cloudflare API Token：My Profile → API Tokens → 用 **Edit Cloudflare Workers** 模板（至少要有 Workers Scripts 的 Edit 权限），给 Workers Builds 部署用

### 1. 建 R2 桶

Workers & Pages → **R2** → Create bucket，名字必须是 `jm-bot-cache`（与 `wrangler.jsonc` 里的绑定一致）。桶本身要先存在，绑定会由部署自动建立。

### 2. 连接仓库

Workers & Pages → Create → **Continue with GitHub** → 按提示给 Cloudflare GitHub App 授权本仓库。

### 3. 填构建设置

| 字段 | 值 |
|---|---|
| Root directory | `/` |
| Build command | `npm install` |
| Deploy command | `npx wrangler deploy --domain "$CUSTOM_DOMAIN"` |
| Production branch | `main` |
| API token | 前面创建的那个 |

### 4. 加 build 变量

在 **Build variables and secrets** 里加一条：`CUSTOM_DOMAIN` = `jm.你的域名.com`

这样域名只存在于 Cloudflare 侧，仓库里不出现你的信息。

### 5. 配 Worker 运行时密钥

部署成功后，进入 Worker → **Settings → Variables and Secrets**（注意这和上面的 build 变量是两处），加三条 **Secret**：

| 名称 | 值 |
|---|---|
| `QQ_APP_ID` | 机器人 AppID |
| `QQ_CLIENT_SECRET` | 机器人 AppSecret（同时用作 Ed25519 签名种子） |
| `LINK_SECRET` | 自己生成的随机长字符串，用来签试读链接 |

生成一个够随机的值：

```bash
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

### 6. 自检

打开 `https://jm.你的域名.com/cryptotest`，期望：

```
ed25519_sign: ok (…)
ed25519_verify: ok
r2: ok
```

`ed25519` 报 FAILED 说明该运行时的 WebCrypto 不支持 Ed25519，需要换成纯 JS 实现。

### 7. 让缓存自动过期

R2 → `jm-bot-cache` → **Lifecycle** → 加规则：前缀 `albums/` 的对象 N 天后删除。这才是"短期链接"的物理过期，签名只是访问闸门。

### 8. QQ 开放平台

1. **回调配置**：接收方式选 **Webhook**，地址填 `https://jm.你的域名.com/qq/callback`，保存时平台会发 `op=13` 验证请求，Worker 自动回签名
2. **事件订阅**：勾选群聊 @消息与单聊消息（`GROUP_AT_MESSAGE_CREATE`、`C2C_MESSAGE_CREATE`）
3. **消息 URL 白名单**：把 `jm.你的域名.com` 加进去 —— **不加白名单，回复里的链接点不开**（上限 20 条、每年只能修改 50 次）
4. **沙箱配置**：加自己的 QQ 号和测试群，先在沙箱跑通再申请上架

然后在群里 `@机器人 350234`。

## 以后怎么更新代码

```bash
npm run check     # tsc
npm test          # 加密实现回归
git push          # Workers Builds 自动构建并部署
```

本地想直接部署也可以：`npm install && npx wrangler login && npx wrangler deploy --domain jm.你的域名.com`。

## 路由

| 路径 | 作用 |
|---|---|
| `POST /qq/callback` | QQ 事件回调；处理 `op=13` 地址校验与 `op=0` 消息事件 |
| `GET /p/<JM号>?ep=<话序号>&e=&s=` | 阅读页，按话渲染 |
| `GET /i/<JM号>/<章节号>/<图片名>?e=&s=` | 图片，R2 缓存旁路 |
| `GET /cryptotest` | 运行时自检：Ed25519 签名/验签 + R2 读写 |
| `GET /qq/last` | 最近一次回调的诊断摘要（事件类型、验签结果、解析到的 JM 号、回复结果；不含消息原文与 openid） |
| `GET /` | 路由说明 |

## 为什么不是 Python / jmcomic

这个项目最初是照 [JMComic-Crawler-Python](https://github.com/hect0x7/JMComic-Crawler-Python) 改造的，接口层后来全部用 TypeScript 重写了，原因都是平台约束：

| 约束 | 后果 |
|---|---|
| Cloudflare Containers 是 **Paid 专属** | 免费计划只能用 Workers，Python 容器路线不成立 |
| 禁漫移动端 API 在 `www.cdnhjk.net` 这类独立域名上，**实测不吃 Cloudflare 反爬** | 不需要 `curl_cffi` 的浏览器指纹伪装，纯 `fetch` 就够 |
| Worker 运行时**没有 MD5**，WebCrypto 也**没有 AES-ECB** 模式 | 两者自行实现，见 `src/crypto.ts` |
| 免费档 **10ms CPU/请求** | 图片解码不能放服务端，改由浏览器 Canvas 还原切条 |

`src/crypto.ts` 里两个实现都有测试兜底：MD5 逐样本对齐 `node:crypto`；AES-ECB 用禁漫真实响应校验（173 个密文块，md5 与 Python 端逐位一致）。

## 源码结构

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 路由、R2 缓存旁路、HMAC 短期链接、QQ 回调分发 |
| `src/crypto.ts` | 手写 MD5 + 用 WebCrypto 的 CBC 还原 AES-ECB |
| `src/jm.ts` | 禁漫移动端接口：匿名 cookie、专辑/章节、scramble_id、切条数计算 |
| `src/qq.ts` | access_token 缓存、Ed25519 签名与验签、群/私聊被动回复 |
| `src/reader.ts` | 阅读页 HTML + 浏览器端 Canvas 还原脚本 |
| `probe/worker.js` | 独立的出口连通性探针，怀疑网络问题时先跑它 |

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入本地值
npm run dev                      # wrangler dev，默认 http://localhost:8787
npm run check                    # tsc --noEmit
npm test                         # 加密实现回归
npm run build                    # 产出单文件 build/worker.js（可选）
```

`npm run build` 产物是给「不想连 GitHub、直接把代码粘进 Cloudflare 后台 Code 编辑器」的人准备的备选路径。走那条路时**不要再混用 wrangler 部署**：wrangler 以配置文件为权威源，会覆盖后台手动改的 routes。

## 额度与限制

免费档：10 万请求/天、10ms CPU/请求、50 子请求/请求、128MB 内存。R2 免费额度：10GB 存储、100 万次写/月、1000 万次读/月，**出站流量不计费**。

- 一次完整试读约消耗 `1 + 该话页数` 个请求
- 章节是**按需抓取**的：打开哪话才抓哪话的图清单，所以百话长篇也不会撞上「50 子请求/请求」上限
- QQ 群聊被动回复窗口只有 **5 分钟、每条消息最多 5 次**，超时返回 `40034128`
- 群里必须 **@机器人** 才会收到事件

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 打开链接 403 `链接已过期` / `签名不匹配` | 超过 `PREVIEW_HOURS`，或 `LINK_SECRET` 改过 |
| 机器人回 `抓取失败：获取 access_token 失败` | Worker 的三条 Secret 没配全（注意是 Worker 的运行时变量，不是 build 变量） |
| 机器人回 `抓取失败：禁漫接口全部失败` | 禁漫换了 API 域名。部署 `probe/worker.js` 看 `hosts` 里各域名的状态码，再更新 `src/jm.ts` 的 `API_HOSTS` |
| `/cryptotest` 里 `ed25519` 报 FAILED | 该运行时不支持 WebCrypto 的 Ed25519，需要换成纯 JS 实现 |
| QQ 后台回调地址校验不过 | 域名没解析到 Cloudflare、证书链不全，或腾讯侧探测延迟过高（社区经验约 500ms 以上会失败） |
| 回复里的链接不可点击 | 域名没加进 QQ 的消息 URL 白名单 |
| 群里 @机器人 没反应 | 打开 `GET /qq/last` 看诊断摘要：显示"还没收到任何回调" → 事件订阅没勾 / 沙箱名单没加你 / 机器人不在群里；`outcome` 是"验签失败已拒绝" → 事件签名约定与平台不一致；`outcome` 里带 QQ 错误码 → 按错误码处理（`40034128` 是超过 5 分钟或 5 次）。另外 **服务器 IP 白名单必须留空**，Cloudflare 出口是大段轮换地址，填了就会拒绝我们的 OpenAPI 调用 |
| 部署报 `Error 1027` | 当天 10 万请求额度用完 |

## 免责声明

本项目仅为技术研究与个人学习用途。目标站点内容的版权归原权利人所有，其内容多为成人向，请遵守所在地的法律法规；QQ 开放平台的应用审核与运营规范同样适用，请勿用于分发、商用或公开传播。使用者自行承担全部风险与后果。

## 许可

MIT
