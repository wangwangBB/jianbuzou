# 健步走签到打点系统 · 独立点位扫码版 v2.0

基于原 `walk-qr-cloudflare-pages-no-password-link.zip` 修改，仍使用 **Cloudflare Pages + Pages Functions + D1**。这是可部署源码包，部署构建时安装二维码依赖；不是可直接拖到 Pages 的纯静态网页包。

## 本次变化

- 签到成功直接显示三个独立点位卡片；同一浏览器访问 `/me` 可回到点位页。
- 点击卡片申请摄像头权限，优先使用后置摄像头。**点击、打开摄像头、识别二维码本身都不会新增打点记录**。
- 服务端验证二维码签名、有效期、所属点位与选手身份，通过后进入本点位随机答题；提交答案后才算完成打点。
- 二维码默认有效 **45 秒**，现场屏幕约每 **20 秒**刷新；有效期可配置为 15～120 秒整数，刷新间隔自动调整。
- 重复或并发提交不能新增第二条点位记录，也不会覆盖首次答案。
- 本站服务端生成二维码，扫码脚本由构建步骤复制到本站；活动时不使用外部二维码生成服务或脚本 CDN。
- 不增加点位密码、专属链接密钥或 `QR_KEY_CP1` 等变量。现场展示与发码接口继续沿用原项目的管理员登录保护。

## 原功能保留

姓名、手机号、原有 15 个部门下拉选项、签到前个人信息确认；随机题库与答题记录；任意一个点位完成后回起点扫码签退；后台统计、详情、单个选手删除、清空选手数据（保留题库）、题库增删；CSV 每名选手一行，包含手机号及三个点位完成信息；同浏览器 Cookie 保持身份及清除本机信息入口。

按原规则，提交有效选项即记录该点位，答错也记录；签退后才算完成比赛。

## 已有项目升级

1. 备份现有项目和 D1 数据，记下当前 `wrangler.toml` 的真实 `database_id`。
2. 将 ZIP 中 `walk-qr-cloudflare-pages/` **里面的文件**覆盖到仓库根目录。必须同步更新 `functions/`、`lib/`、`public/`、`scripts/`、`package.json`，不能只替换 `_app.js`。
3. **保留自己的 `wrangler.toml`，不要把数据库 ID 覆盖成 ZIP 的占位符。** 上传原包没有真实 ID，只有 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。
4. Cloudflare Pages 构建配置改为下表；核对 `DB` 绑定仍指向原数据库。
5. 核对环境变量和 Secret，重新部署，刷新所有工作人员二维码屏幕。
6. **本次没有数据库结构变更**，已有 `phone` 字段的数据库无需迁移。不要清库或重新执行 `seed.sql`；重复导入种子文件会产生重复题目。
7. 在活动开始前升级。旧版二维码及旧答题页面将失效，需要重新扫描；若保持 `QR_SECRET` 不变，原有选手 Cookie 可继续使用。更换密钥则所有选手和管理员会话都失效。

| 构建项目 | 值 |
| --- | --- |
| Framework preset | None |
| Build command | `npm install && npm run build` |
| Build output directory | `public` |
| Root directory | 留空，表示仓库根目录 |
| 环境变量 `NODE_VERSION` | `24` |

**旧版“构建可留空、无需 npm 二维码依赖”的说明不适用于本版。** 新版固定使用 `jsqr@1.4.0`、`qrcode-generator@1.4.4`；缺少依赖时构建会报错，避免发布没有扫码组件的页面。

## 首次部署

1. 创建 GitHub 仓库，将项目目录内文件放到仓库根目录，`functions/` 与 `public/` 同级。
2. 创建 Cloudflare D1 数据库（建议名 `walk_qr_db`），填入 `wrangler.toml` 的真实 `database_id`。
3. 仅新库先执行 `schema.sql`，再执行一次 `seed.sql`。
4. 创建 **Pages** 项目并连接 Git，采用上方构建配置。不要只上传 `public/`，否则不会部署业务 Functions。
5. 配置 D1 binding `DB` 和下列环境变量，重新部署。预览环境建议使用独立测试数据库。
6. 访问 `https://你的项目.pages.dev/admin` 登录。

```toml
name = "walk-qr-cloudflare-pages"
compatibility_date = "2025-01-01"
pages_build_output_dir = "public"

[[d1_databases]]
binding = "DB"
database_name = "walk_qr_db"
database_id = "你的真实数据库ID"
```

很早版本数据库若缺手机号列，先用 `PRAGMA table_info(participants);` 确认，仅在缺列时执行 `migration_add_phone.sql`。仍保留原版自动补 `phone` 列逻辑。

## 环境变量

| 名称 | 用途 |
| --- | --- |
| `ADMIN_PASSWORD` | 必填，独立后台密码；不能使用旧公开默认值 `admin123456`。没有点位单独密码。 |
| `QR_SECRET` | 必填，至少 32 位随机密钥；不能使用示例占位符。签名二维码及会话。 |
| `EVENT_TITLE` | 可选，活动名称。 |
| `QR_TOKEN_TTL_SECONDS` | 默认 `45`，仅接受 15～120 的整数，其余回退为 45。 |
| `ACTION_TOKEN_TTL_SECONDS` | 默认 `600`，仅接受 120～900 的整数，控制签到确认、答题、签退确认时限。 |
| `NODE_VERSION` | 构建环境建议 `24`。 |

将后台密码和签名密钥保存为 Pages Secret。缺少安全配置时系统显示配置提示，不再采用公开默认密码和密钥。生成随机密钥示例：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

不要提交真实 Secret 到 Git。`.dev.vars.example` 仅作格式示例，本地复制成 `.dev.vars` 后填自己的值。

## 现场使用

工作人员四个屏幕分别登录后台后，打开以下独立页面，每页只展示对应点位码：

| 位置 | 路径 |
| --- | --- |
| 起点 | `/display/start` |
| 点位一 | `/display/cp1` |
| 点位二 | `/display/cp2` |
| 点位三 | `/display/cp3` |

不要在选手设备登录管理员账号，不要把后台四码汇总页面当作现场打点屏幕。保持屏幕联网和常亮；刷新失败时旧码到期会隐藏。

选手流程：

1. 起点扫码，填写姓名、手机号、选择部门，核对后确认签到。
2. 成功页直接出现三个卡片，无需退出或重新登录。
3. 到达某点位，点击对应卡片，允许摄像头权限，对准该点位现场屏幕。
4. 验证通过后答题，默认 10 分钟内提交。只有提交后才完成点位。已通过扫码验证且仍在答题时限内时，展示码随后过期不会中断答题。
5. 任意一点位完成后回起点，点击“扫描起点二维码，办理签退”，扫描现场码，再确认签退。
6. 签退后不能继续打点。

也保留外部扫一扫直接打开有效现场码的兼容路径，仍须相同的服务端签名、有效期、身份及重复校验。请始终使用签到时的同一浏览器；换浏览器可能识别不到 Cookie。

## 防作弊校验及边界

- **点位绑定**：签名包含 `start/cp1/cp2/cp3` 点位码、版本、签发/到期时间及随机值；篡改点位或到期时间会导致验签失败。
- **独立入口**：卡片所选点位必须等于签名码中的点位。点位一入口扫描点位二、三或起点码会被拒绝。仅访问 `?point=cp1`、按钮或无签名链接无法取得答题授权。
- **短时有效**：以服务器时间为准，到达过期秒即失效。展示屏及发码接口要求工作人员登录，选手不能自行获取新码。
- **答题绑定**：扫码通过才签发短时答题凭证，绑定当前选手、点位和题目，不能借用其他选手凭证提交。
- **防重复**：数据库 `UNIQUE(participant_id, point_code)` 加原子写入防止并发重复；插入时再次确认选手未签退、未删除、题目仍可用。
- **回起点签退**：点位页不直接发签退凭证，须重新扫描有效起点码，并至少完成一个点位。

**无法保证完全杜绝作弊。** 现场多人需要扫描同一个有效码，所以码不是全局一次性；重复限制针对同一选手的同一点位。短时二维码无法阻止有效期内的实时转发、视频共享、代扫或冒用身份，网页请求也不能证明真实地理位置。本版未添加 GPS、人脸、短信验证或到场硬件。工作人员应看管展示屏，不公开实时码和后台权限。

手机号仍为登记字段，不是短信认证；沿用原来的姓名、手机号、部门匹配进行中签到记录的逻辑，不引入新实名或设备绑定规则。

## 摄像头及常见问题

- 使用 Pages 的 HTTPS 地址。首次会弹系统权限提示，不能绕过。
- 真机验收 iPhone、安卓及实际使用的微信内置浏览器；部分内置浏览器可能不允许网页摄像头，不能保证所有微信版本可用。
- 若需改用系统浏览器，应从起点开始在该浏览器建立签到身份，避免微信签到、其他浏览器打点。
- 只提供实时摄像头扫码，没有相册上传或粘贴码入口。关闭、切后台和离开页面会释放摄像头。
- “扫码组件未加载”：检查构建日志及 `/assets/jsQR.js`，不要漏传 `public/_routes.json` 或跳过构建。
- “点位不匹配”：返回点位页选择实际所在点位，扫描相应屏幕。
- “二维码已过期或无效”：扫描现场最新码；升级后刷新全部展示屏。
- “请完成部署配置”：设置独立后台密码与至少 32 位随机密钥，重新部署。
- “Could not resolve qrcode-generator”：检查 `package.json` 是否上传，构建是否安装依赖；新版不再使用外部生成接口兜底。

## 文件及依赖

```text
functions/_app.js             业务路由、页面、D1 和校验
functions/index.js            Pages 首页入口
functions/[[path]].js         Pages 其他路由入口
lib/qr.js                     本站生成 SVG 二维码（不作为公开路由）
public/assets/scanner.js      摄像头、识别提交、权限及关闭处理
public/assets/qr-display.js   展示码刷新及到期隐藏
public/assets/jsQR.js         构建生成，不包含在源码 ZIP 中
public/_routes.json           /assets/* 为静态路径，其余进 Functions
scripts/build.mjs             复制固定版本 jsQR 到静态目录
tests/                        业务、并发、摄像头逻辑和二维码集成测试
schema.sql                    与原包一致，本次无需迁移
seed.sql                      新库示例题库，仅执行一次
migration_add_phone.sql       很早版本的可选手机号迁移
wrangler.toml                 需填真实 D1 ID
package.json
.dev.vars.example
```

二维码依赖使用 MIT 许可证，见 `THIRD_PARTY.md`。原始许可证随 npm 包提供。

## 本地运行及测试

建议 Node.js 24。业务测试使用内置 SQLite 执行真实 SQL，并适配 D1 接口；不访问真实活动数据库。

```sh
# 不依赖 npm 下载的业务与摄像头控制逻辑测试
npm test

# 在允许下载依赖的环境中执行
npm install
npm run build
npm run test:qr

# 本地调试；先填写 .dev.vars
npx wrangler d1 execute walk_qr_db --local --file=schema.sql
npx wrangler d1 execute walk_qr_db --local --file=seed.sql
npm run dev

# 本地部署；须先 wrangler 登录及填写数据库 ID
npm run deploy
```

`npm install` 会生成锁文件，验证后可一并提交。正式题库请在后台调整。

## 交付验证与上线验收

已通过 **36 项本地自动测试**，详见 `TEST_REPORT.md`。2026-11-03 已补做依赖安装、构建及 2 项二维码集成测试，全部通过。真实 D1 联调和真机扫码仍待完成；模拟摄像头测试不等于真机验收。

- [ ] Pages 构建通过，D1 绑定正确，安全配置生效，`/assets/jsQR.js` 可加载。
- [ ] 安装依赖后 `npm run test:qr` 通过；四个现场码均可生成、刷新并被手机识别。
- [ ] 签到含手机号、部门下拉、信息确认，成功后直接出现三个卡片。
- [ ] 点卡片仅开摄像头，取消不会新增记录。
- [ ] 跨点位、起点混用、过期截图及篡改链接均被拒绝。
- [ ] 扫码未答题仍未完成，答题新增一条；重复提交不增加，超时需重扫。
- [ ] 零点位不能签退；任意一点位完成后回起点扫码可签退；签退后不能再打点。
- [ ] CSV 每人一行、手机号正确；删除和清空功能正常且保留题库。
- [ ] 真机检查权限拒绝、关闭和重新打开、切后台；展示屏断网后隐藏过期码。

参考：[Pages 路由](https://developers.cloudflare.com/pages/functions/routing/)、[D1 语句](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)、[摄像头 API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)、[jsQR](https://github.com/cozmo/jsQR)、[二维码生成器](https://github.com/kazuhikoarase/qrcode-generator)。
