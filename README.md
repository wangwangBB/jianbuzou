# 健步走签到打点系统（Cloudflare Pages 版）

这是一个部署在 Cloudflare Pages 上的健步走签到、打点、答题、签退系统。

技术结构：

- Cloudflare Pages：提供 `*.pages.dev` 访问地址和 GitHub 自动部署。
- Pages Functions：处理后台登录、扫码、签到、答题、签退、导出 CSV 等动态逻辑。
- Cloudflare D1：保存选手、题库、打点和答题记录。

> 说明：纯静态 Pages 不能安全地保存签到和答题数据，所以本项目使用 Pages Functions。它仍然是 Pages 项目，访问地址是 `pages.dev`，不是 `workers.dev`。

---

## 一、功能说明

### 选手端

1. 起点扫码签到，填写姓名和部门。
2. 到点位一、点位二、点位三扫码。
3. 每个点位扫码后随机抽取一道题，手机答题。
4. 后台记录选手点位、题目、选择答案、正确答案、是否正确、提交时间。
5. 完成任意一个点位后，回到起点扫码签退。
6. 签退后才算完成比赛。

### 后台端

访问：

```txt
https://你的项目.pages.dev/admin
```

后台功能：

- 查看已签到、进行中、已完成统计。
- 查看选手列表。
- 查看选手详情和答题记录。
- 导出 CSV：每名选手只占一行，导出姓名、部门、签到/签退状态和完成点位信息。
- 打开起点和三个点位的动态二维码。
- 管理题库。

---

## 二、项目文件说明

```txt
walk-qr-cloudflare-pages/
├─ functions/
│  ├─ _app.js          # 核心后台、扫码、答题逻辑
│  ├─ index.js         # 首页路由
│  └─ [[path]].js      # 全路径兜底路由，负责 /admin、/scan 等
├─ public/
│  ├─ index.html       # 静态入口，自动跳转 /admin
│  ├─ _routes.json     # 让所有路径经过 Pages Functions
│  └─ _headers         # 基础安全响应头
├─ schema.sql          # 数据库表结构
├─ seed.sql            # 示例题库
├─ wrangler.toml       # Pages + D1 配置
├─ package.json        # 依赖配置
└─ README.md
```

---

## 三、部署方式：GitHub + Cloudflare Pages

### 1. 上传到 GitHub

1. 在 GitHub 新建仓库，例如：

```txt
walk-qr-cloudflare-pages
```

2. 解压本项目 ZIP。
3. 把项目内所有文件上传到 GitHub 仓库根目录。

注意：`functions`、`public`、`schema.sql`、`seed.sql`、`wrangler.toml` 必须在仓库根目录。

---

### 2. 创建 D1 数据库

Cloudflare 后台：

```txt
Workers & Pages → D1 SQL Database → Create database
```

数据库名称建议：

```txt
walk_qr_db
```

创建后复制 `database_id`。

打开 GitHub 仓库里的 `wrangler.toml`，把：

```toml
REPLACE_WITH_YOUR_D1_DATABASE_ID
```

替换成你的真实 `database_id`。

最终类似：

```toml
[[d1_databases]]
binding = "DB"
database_name = "walk_qr_db"
database_id = "8f3a1c2d-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

---

### 3. 初始化数据库表

进入 Cloudflare 的 D1 数据库页面，找到 Console / Query 控制台。

先复制并执行 `schema.sql`。

执行后如果提示“此查询未返回数据”，是正常的，因为建表语句本来不返回查询结果。

然后复制并执行 `seed.sql`，导入示例题库。

检查题库是否导入：

```sql
SELECT COUNT(*) AS total FROM questions;
```

返回大于 0 即可。

---

### 4. 创建 Cloudflare Pages 项目

Cloudflare 后台：

```txt
Workers & Pages → Create application → Pages → Connect to Git
```

选择你的 GitHub 仓库。

构建配置建议：

```txt
Framework preset: None
Build command: npm install
Build output directory: public
Root directory: /
```

然后点击部署。

---

### 5. 绑定 D1 数据库到 Pages Functions

如果你已经在 `wrangler.toml` 中正确填写 D1，部分情况下 Cloudflare 会自动识别。

如果后台访问时提示 `DB` 未绑定，请手动绑定：

```txt
Pages 项目 → Settings → Bindings → Add binding → D1 database
```

填写：

```txt
Variable name: DB
D1 database: walk_qr_db
```

生产环境和预览环境建议都绑定一次。

---

### 6. 设置环境变量 / Secret

进入 Pages 项目：

```txt
Settings → Environment variables
```

添加生产环境变量：

```txt
ADMIN_PASSWORD = 你的后台密码
QR_SECRET = 一串长随机密钥
EVENT_TITLE = 健步走签到打点系统
QR_KEY_START = 起点二维码专属链接密钥
QR_KEY_CP1 = 点位一二维码专属链接密钥
QR_KEY_CP2 = 点位二二维码专属链接密钥
QR_KEY_CP3 = 点位三二维码专属链接密钥
```

示例：

```txt
ADMIN_PASSWORD = bjdc!001
QR_SECRET = walk_qr_secret_2026_TJGN_9xKp72LmQ4vR
EVENT_TITLE = 2026年安全生产月健步走活动
QR_KEY_START = Start_2026_x9A
QR_KEY_CP1 = CP1_2026_p7K
QR_KEY_CP2 = CP2_2026_m8Q
QR_KEY_CP3 = CP3_2026_z5T
```

注意：

- `ADMIN_PASSWORD` 是后台登录密码。
- `QR_SECRET` 是动态二维码签名密钥，不能太简单。
- `QR_KEY_START`、`QR_KEY_CP1`、`QR_KEY_CP2`、`QR_KEY_CP3` 是各二维码展示页的专属链接密钥。后台会自动生成带 `?k=` 的链接，分别发给起点和三个点位工作人员使用。
- 改完环境变量后建议重新部署一次。

---

## 四、使用方式

部署成功后访问：

```txt
https://你的项目.pages.dev/admin
```

登录后台后，进入：

```txt
动态二维码
```

分别打开：

- 起点签到 / 签退二维码
- 点位一二维码
- 点位二二维码
- 点位三二维码

现场可以用四台电脑、四个平板或四部手机分别显示四个二维码。

二维码会自动刷新。选手扫码后，后台会判断当前二维码是否有效。

---

## 五、点位规则

系统默认三个点位：

```txt
cp1 = 点位一
cp2 = 点位二
cp3 = 点位三
```

规则：

- 必须先在起点签到。
- 每个点位只能成功记录一次。
- 每个点位必须完成答题后才算该点位完成。
- 完成任意一个点位后，起点扫码页面就会显示“确认签退”。
- 签退后，状态变为“已完成”。

---

## 六、题库说明

题库表支持：

```txt
ALL：通用题，三个点位都可能抽到
cp1：仅点位一抽取
cp2：仅点位二抽取
cp3：仅点位三抽取
```

后台可以新增和删除题目。

也可以直接在 D1 控制台插入题目，例如：

```sql
INSERT INTO questions
(point_code, title, option_a, option_b, option_c, option_d, correct_option, explanation, enabled, created_at)
VALUES
('ALL', '安全生产方针是什么？', '安全第一、预防为主、综合治理', '效率第一', '成本优先', '只重生产', 'A', '', 1, datetime('now'));
```

---

## 七、常见问题

### 1. `/admin` 还是 404？

检查这些项目文件是否存在：

```txt
functions/[[path]].js
functions/index.js
functions/_app.js
public/_routes.json
```

并确认你创建的是 Cloudflare Pages 项目，不是只上传了静态文件。

### 2. 提示 DB 未绑定？

到 Pages 项目设置里手动添加 D1 binding：

```txt
Variable name: DB
Database: walk_qr_db
```

### 3. 登录密码是什么？

如果没有设置 `ADMIN_PASSWORD`，系统临时默认密码是：

```txt
admin123456
```

正式活动前必须在 Pages 环境变量中设置自己的后台密码。

### 4. QR_SECRET 可以随便填吗？

可以自己填，但必须足够长、随机、复杂。不要用 `123456`、`admin`、单位拼音等简单内容。


### 点位二维码页面专属链接密钥

为了防止不同点位工作人员互相打开或代开二维码，系统支持为每个二维码展示页设置专属链接密钥：

```txt
QR_KEY_START = 起点二维码专属链接密钥
QR_KEY_CP1 = 点位一二维码专属链接密钥
QR_KEY_CP2 = 点位二二维码专属链接密钥
QR_KEY_CP3 = 点位三二维码专属链接密钥
```

设置后，后台“动态二维码”页面会生成类似下面的工作人员专属链接：

```txt
/display/cp1?k=CP1_2026_p7K
```

把对应链接发给对应点位工作人员即可，工作人员不需要输入密码。没有正确 `k=` 密钥时，普通工作人员无法打开该点位二维码页面。后台管理员登录后仍可从“动态二维码”页面统一查看和打开。

如果某个点位密钥未设置，该点位二维码展示页将只允许后台管理员打开；普通工作人员打开时会提示先配置对应环境变量。

### 5. 选手换手机后怎么办？

当前系统通过手机 Cookie 识别选手。如果选手换手机，需要重新起点签到；或者由后台工作人员核对记录。

### 6. 一个手机多人使用怎么办？

手机端有“清除本机签到信息”入口。清除后可重新给另一名选手签到。

---

## 八、相较 Worker 版的变化

保留：

- 后台管理
- D1 数据库记录
- 动态二维码
- 起点签到
- 三个点位扫码答题，完成任意一个点位即可签退
- 起点签退
- CSV 导出：每名选手一行，不导出题目信息，只导出完成点位信息

变化：

- 项目部署为 Cloudflare Pages。
- 访问地址使用 `pages.dev`。
- 动态逻辑通过 Pages Functions 实现。
- 不再使用 `workers.dev` 默认地址。

---

## 九、正式活动前测试清单

1. 用不挂代理的手机访问 `/admin`。
2. 后台登录是否正常。
3. D1 题库数量是否大于 0。
4. 起点二维码扫码是否能签到。
5. 点位一、点位二、点位三是否能随机抽题。
6. 未完成任何点位前是否无法签退。
7. 完成任意一个点位后是否可以签退。
8. 后台记录是否完整。
9. CSV 导出是否正常。
10. 用移动、联通、电信网络分别测试访问速度。


## 构建报错 `Could not resolve "qrcode"` 的说明

本版本已经去掉 `qrcode` 这个 npm 依赖，二维码由 Pages Function 生成短时签名链接后调用在线二维码接口返回图片。
因此 Cloudflare Pages 日志中即使显示 `No build command specified. Skipping build step.` 也可以正常构建 Functions。

如果你使用的是旧版本代码，看到如下报错：

```txt
Could not resolve "qrcode"
```

请更新到本版本，或删除旧代码第一行的 `import QRCode from "qrcode";` 并替换 `/api/qrcode.svg` 的生成逻辑。

## 本版本新增功能

### 1. 签到增加手机号

选手在起点扫码签到时需要填写：

- 姓名
- 手机号
- 部门

手机号会写入 `participants.phone` 字段，并在后台列表、选手详情和 CSV 导出中显示。

### 2. 部门改为下拉菜单

签到页面不再手动输入部门，而是从以下规范部门中选择：

- 公司领导
- 党群与综合部
- 人力资源部
- 市场营销与经营管理部
- 新能源部（业务发展部）
- 财务部
- 采购与合同管理部
- 生产技术部
- 安健环管理部
- 发电运行部
- 设备维护部
- 海水淡化部
- 燃料管理部
- 北疆环科
- 北疆能源销售

### 3. 签到前增加个人信息确认

起点扫码后，选手先填写信息；点击下一步后进入“确认个人信息”页面。选手确认姓名、手机号和部门无误后，才会正式写入数据库并完成签到。

### 4. 后台可直接删除选手数据

后台记录列表新增：

- 单个选手删除按钮：删除该选手的签到、点位、答题和签退记录。
- 清空选手数据按钮：删除全部选手记录，但不会删除题库。

### 5. 数据库字段变更

新版 `schema.sql` 已包含手机号字段：

```sql
phone TEXT NOT NULL DEFAULT ''
```

如果你是旧数据库升级，建议在 Cloudflare D1 Console 执行：

```sql
ALTER TABLE participants ADD COLUMN phone TEXT NOT NULL DEFAULT '';
```

本项目代码也加入了自动补字段逻辑，访问系统时会尝试自动为旧数据库添加 `phone` 字段；手动执行迁移更稳。
