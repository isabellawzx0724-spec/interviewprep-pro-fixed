# Interview Navigator 部署指南（给完全不懂部署的人）

这是最稳、最容易成功的方案：
- 前端：Vercel
- 后端 API：Render
- AI：OpenAI API

> 先上线 MVP，暂时不要打开小红书 / 牛客实时抓取。先保证网站能用，再处理抓取与合规。

---

## 一、你最终会得到什么

部署完成后，你会有两个网址：
1. 一个前端网址（用户打开的网站）
2. 一个后端网址（给前端调用的 API）

---

## 二、你要先准备的 4 样东西

1. **GitHub 账号**
2. **Vercel 账号**
3. **Render 账号**
4. **OpenAI API Key**

如果没有，就先注册：
- GitHub
- Vercel
- Render
- OpenAI Platform

---

## 三、先解压这个项目

1. 下载 zip
2. 双击解压
3. 你会看到一个文件夹：`interviewprep-pro`

---

## 四、把项目上传到 GitHub

### 方法 A：最简单的方法（推荐）

1. 打开 GitHub
2. 点击右上角 `+`
3. 选择 **New repository**
4. Repository name 填：`interviewprep-pro`
5. 选择 **Public** 或 **Private** 都可以
6. 点击 **Create repository**

然后把本地文件夹上传进去：

#### 如果你不会命令行
最简单方法是：
- 打开新建好的 GitHub 仓库页面
- 选择 **uploading an existing file**
- 把整个项目里的文件拖进去

注意：
- 不是把 zip 直接上传
- 是把 **解压后的文件内容** 上传

你应该上传这些：
- `backend/`
- `frontend/`
- `.env.example`
- `README.md`
- `render.yaml`
- `DEPLOYMENT_GUIDE.md`

---

## 五、先部署后端（Render）

### 1）登录 Render

进入 Render Dashboard。

### 2）新建 Web Service

1. 点击 **New +**
2. 选择 **Web Service**
3. 连接你的 GitHub
4. 选择仓库：`interviewprep-pro`

### 3）填写部署信息

按下面填：

- **Name**: `interview-navigator-api`
- **Root Directory**: `backend`
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`

### 4）配置环境变量

在 Render 的 Environment Variables 里添加：

- `OPENAI_API_KEY` = 你的 OpenAI key
- `ALLOW_LIVE_SCRAPE` = `false`
- `ALLOWED_ORIGIN` = 先随便填 `*`，等前端上线后再改成前端正式网址
- `NODE_VERSION` = `22`

### 5）点击 Deploy

部署成功后，你会拿到一个后端地址，例如：

`https://interview-navigator-api.onrender.com`

### 6）测试后端是否正常

浏览器打开：

`https://你的-render-网址/api/health`

如果看到类似：

```json
{"ok":true,"product":"Interview Navigator API"}
```

就说明后端正常。

---

## 六、再部署前端（Vercel）

### 1）登录 Vercel

进入 Vercel Dashboard。

### 2）导入 GitHub 项目

1. 点击 **Add New...**
2. 选择 **Project**
3. 选择你的 GitHub 仓库 `interviewprep-pro`

### 3）设置 Root Directory

非常重要：
- **Root Directory** 选 `frontend`

### 4）配置环境变量

添加：

- `VITE_API_BASE_URL` = 你的 Render 后端地址

例如：

`https://interview-navigator-api.onrender.com`

### 5）点击 Deploy

部署完成后，你会拿到一个前端网址，例如：

`https://interviewprep-pro.vercel.app`

---

## 七、把后端的跨域限制改正确

前端上线后，回到 Render。

把后端环境变量里的：

- `ALLOWED_ORIGIN`

从 `*` 改成你的前端正式网址，例如：

`https://interviewprep-pro.vercel.app`

然后点击 **Manual Deploy** / **Redeploy**。

这一步做完更安全。

---

## 八、正式测试整个网站

打开你的前端网址，测试这 3 件事：

### 测试 1：页面是否正常打开
- 能看到首页
- 能切换中英文
- 输入公司、岗位、JD、简历

### 测试 2：是否能生成 Prep Pack
点击生成按钮后，右边应该出现：
- 面经摘要
- JD 题目
- 简历深挖题
- 公司文化适配
- 一页纸小抄

### 测试 3：反馈功能能否提交
在页面底部提交一条面试反馈。

---

## 九、你现在要知道的两个现实问题

### 问题 1：反馈数据目前是文件存储
现在这版是把反馈写到服务器文件里。
这适合 MVP 测试，但不适合长期商用。

真正商用建议下一步改成：
- Supabase Postgres
- 或 Render Postgres

### 问题 2：小红书 / 牛客抓取默认关闭
这是故意的。
因为这些站点的实时抓取通常会涉及：
- 登录态
- cookie
- 反爬
- 平台规则
- 法律与合规风险

所以现在先让主产品上线，再决定是否启用抓取层。

---

## 十、你现在最推荐的上线顺序

请严格按这个顺序：

1. 上传 GitHub
2. 部署 Render 后端
3. 测试 `/api/health`
4. 部署 Vercel 前端
5. 填 `VITE_API_BASE_URL`
6. 回 Render 把 `ALLOWED_ORIGIN` 改成前端域名
7. 整站测试
8. 再决定要不要做数据库 / 登录 / 支付 / 抓取

---

## 十一、如果你卡住，最常见错误是这 5 个

### 1. 前端打不开生成功能
通常是 `VITE_API_BASE_URL` 没填对。

### 2. 浏览器报 CORS 错误
通常是 Render 里的 `ALLOWED_ORIGIN` 没设置成前端网址。

### 3. Render 部署失败
通常是 Root Directory 没填 `backend`。

### 4. Vercel 部署失败
通常是 Root Directory 没填 `frontend`。

### 5. 页面能开，但没有 AI 内容
通常是 `OPENAI_API_KEY` 没填，或者 key 无效。

---

## 十二、真正商业化之前，你下一步最该加什么

优先级建议：
1. 数据库（保存反馈、公司、岗位、面经）
2. 登录系统
3. 历史项目保存
4. Stripe 支付
5. 管理后台
6. 抓取任务调度
7. 面经去重和可信度打分


---

## 十二、如果你真的要做“小红书 / 牛客真爬虫”，你需要自己参与的部分

现在这版代码已经把站内抓取入口和直链展示准备好了，但要拿到真正可用的帖子结果，你仍然需要你自己电脑上的登录态：

### 你要做的事

1. 在你自己的浏览器里登录牛客和小红书
2. 打开开发者工具，复制对应站点的 cookie
3. 把这些值填到后端环境变量里：
   - `ALLOW_LIVE_SCRAPE=true`
   - `NOWCODER_COOKIE=...`
   - `XIAOHONGSHU_COOKIE=...`
4. 重新部署后端

### 为什么必须你自己来做

因为这些站点的可用抓取通常依赖：
- 你自己的登录态
- 你自己的 cookie
- 站点当下的反爬状态
- 你自己的网络环境

也就是说：
- 我可以把抓取代码、接口、前端展示逻辑和环境变量位都给你搭好
- 但要不要真的抓到帖子，最后还是取决于你本机登录态是否可用

### 更稳的调试方式

如果你想先在自己电脑本地验证，而不是一上来就放到 Render：

1. 先在本地安装 Node 20+
2. 在 `backend/.env` 里填上：
   - `OPENAI_API_KEY`
   - `ALLOW_LIVE_SCRAPE=true`
   - `NOWCODER_COOKIE=...`
   - `XIAOHONGSHU_COOKIE=...`
3. 本地跑后端，再访问前端页面测试“面经证据”页和生成准备包

### 现实提醒

即使配置完 cookie，也不代表长期稳定，因为这些平台可能随时改：
- 搜索页结构
- 登录校验
- 反爬策略
- 帖子可见范围

所以如果你后面要真正产品化，最稳的方向不是“把浏览器搜索结果塞回来”，而是：
- 保留真实直链抓取能力
- 对抓取失败做明确提示
- 同时维护你自己的结构化面经库和用户反馈库

---

## 十三、把反馈和会话从文件存储切到数据库（推荐你现在就做）

这版代码已经支持：
- 没有 `DATABASE_URL` 时：继续走文件存储
- 有 `DATABASE_URL` 时：自动改走 Postgres

### 你在 Render 要做什么

1. 在 Render 新建一个 Postgres 数据库
2. 复制它的连接串
3. 回到你的后端 Web Service，新增环境变量：
   - `DATABASE_URL=你的 postgres 连接串`
   - `DATABASE_SSL=false`
4. 点击 **Manual Deploy** / **Redeploy**

### 怎么确认数据库已经接上

部署成功后，打开：

- `https://你的-render-后端域名/api/health`

如果返回里看到：

- `storage.mode = "database"`
- `storage.ready = true`

就说明已经不是文件存储了。

### 注意

如果你用的不是 Render Postgres，而是别的平台的托管数据库（例如 Supabase Postgres），可能需要：

- `DATABASE_SSL=true`

---

## 十四、怎么本地联调真爬虫（牛客 / 小红书）

### 你本机要先准备

1. 安装 Node.js 20+
2. 在项目根目录创建或补全 `.env`
3. 填这些值：

```env
OPENAI_API_KEY=你的 OpenAI key
DATABASE_URL=
DATABASE_SSL=false
ALLOW_LIVE_SCRAPE=true
PLAYWRIGHT_HEADLESS=false
SCRAPE_TIMEOUT_MS=20000
NOWCODER_COOKIE=你复制的牛客 cookie
XIAOHONGSHU_COOKIE=你复制的小红书 cookie
ALLOWED_ORIGIN=http://localhost:5173
```

### 为什么本地调试时建议 `PLAYWRIGHT_HEADLESS=false`

因为这样浏览器会弹出来，你能直接看到：
- 有没有被重定向到登录页
- cookie 有没有失效
- 页面是不是被反爬拦住了
- 抓取结果到底有没有出来

### 本地调试顺序

1. 进 `backend/`
2. 安装依赖：`npm install`
3. 启动后端：`npm run dev`
4. 先不要急着打开前端
5. 先访问这个接口单独测爬虫：

```text
http://localhost:8787/api/interview/scrape/debug?company=Tencent&role=Business%20Development%20Intern
```

### 你要看什么

返回 JSON 里重点看：
- `data.config.enabled`
- `data.config.hasNowcoderCookie`
- `data.config.hasXiaohongshuCookie`
- `data.results`
- `data.warnings`

### 判读方式

如果：
- `enabled=false`
  说明你没打开 `ALLOW_LIVE_SCRAPE`
- `hasNowcoderCookie=false` 或 `hasXiaohongshuCookie=false`
  说明对应 cookie 没传进去
- `results=[]` 但没有报错
  说明页面可能打开了，但没抓到目标链接
- `warnings` 里提示跳登录、超时、被拒绝
  说明 cookie 失效或站点反爬更强了

### 爬虫调通后再做什么

等 `/scrape/debug` 能返回真实帖子链接后，再：
- 启动前端
- 去“面经证据”页验证直链展示
- 再走“生成准备包”完整流程

---

## 十五、你现在怎么查看“最新网页”有没有更新

你现在的部署结构是：
- GitHub：代码源头
- Render：后端 API
- Vercel：前端网页

所以你要分开看：

### A. 如果你改的是前端代码

例如：
- `frontend/src/App.jsx`
- `frontend/src/styles.css`
- `frontend/src/lib/i18n.js`

那你需要看：
- Vercel 是否完成了新部署
- 打开的是否是最新前端域名

操作：
1. push 到 GitHub
2. 打开 Vercel 项目
3. 看 **Deployments** 列表里最新一次是否成功
4. 点开最新 deployment URL
5. 强制刷新浏览器（Mac 通常 `Cmd + Shift + R`）

### B. 如果你改的是后端代码

例如：
- `backend/src/routes/interviewRoutes.js`
- `backend/src/services/*.js`
- `backend/src/utils/storage.js`

那你需要看：
- Render 是否完成了新部署
- `/api/health` 是否返回最新状态

操作：
1. push 到 GitHub
2. 打开 Render 服务
3. 看最新 deploy 是否成功
4. 打开：`https://你的-render-域名/api/health`
5. 确认新的字段是否已经出现，例如 `storage.mode`

### C. 如果你改的是环境变量

这是最容易漏掉的地方。

- 改 Render 环境变量：通常要重新部署后端
- 改 Vercel 环境变量：通常要重新部署前端

也就是说：
- 改了 `DATABASE_URL`、`ALLOW_LIVE_SCRAPE`、cookie、`OPENAI_API_KEY`
  你要看 Render
- 改了 `VITE_API_BASE_URL`
  你要看 Vercel

### D. 你如何判断网页还是旧的

常见信号：
- 页面 UI 没变化，但你已经 push 了前端代码
  通常是 Vercel 没重新部署，或者浏览器缓存
- 页面能打开，但新接口字段没生效
  通常是 Render 还是旧版本
- 前端报错请求失败
  通常是 Render 环境变量或 CORS 还没更新

### 最稳的检查顺序

每次更新后按这个顺序看：

1. GitHub 上确认 commit 已经 push
2. Vercel 看前端 deployment 是否 success
3. Render 看后端 deployment 是否 success
4. 先测 `/api/health`
5. 再打开前端网页
6. 浏览器强制刷新

