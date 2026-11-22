# LongwaySite 项目结构分析

| 项 | 值 |
|---|---|
| 最后更新 | 2026-11-21 |
| 仓库 | https://github.com/LongwayStar/longwaystar.github.io |
| 部署 | GitHub Pages，`main` 分支根目录，域名 `longwaystar.github.io` |
| 代码规模 | `index.html` 1002 行 · `lib/js/blog.js` 1556 行 · `markdown.js` 1297 行 · `highlight.js` 815 行 · `html.js` 465 行 · `history.js` 435 行 · 五份 CSS 共 3273 行 |

**本文覆盖面**：目录结构 → 页面架构与路由 → 八个功能模块的实现方式（主题 / 侧边栏 / 背景 / 历史与致谢 / 博客核心 / 维护脚本 / 子站点 / 404 页）→ 状态与缓存键 → 改动入口速查表 → 本地预览 → 验证方法 → 附录（新增文章的完整步骤、一句话总览）。

**阅读建议**：想改内容看 §4.5 的数据契约与附录 A；想改样式看 CSS 的变量（§六 速查表）；想改行为看 §4.5 与 `blog.js`；**只想知道"这是什么"看附录 B**。

> **维护约定（改本文时请照做）**：每次改动这篇文章后，把 `info/time.txt` 的**最后一行**改成当天日期（紧凑写法 `YYYYMMDD`，如 `20261003`）。**当天已经写过就不必重复添加**（同一天不会因为多写一行而让缓存失效，反而会在悬停提示里出现两条相同日期）。这一行是读者端缓存判断"这篇变了没有"的唯一依据——不更新，读者看到的就还是旧版。

---

## 一、项目是什么

一个**纯静态、零构建工具**的个人主页 + 博客站点：

- 没有 npm / 打包器 / 框架 / 后端，全部是手写 `HTML + CSS + 原生 JS`。
- 所有动态数据来源是仓库里的 **文本文档（.txt / .md）和图片**，由浏览器 `fetch()` 在运行时读取。
- 因此"发一篇文章"= 新增一个文件夹 + 改一行 `list.txt`，不需要任何编译或部署步骤（`git push` 即上线）。

技术栈：原生 ES2017+（`async/await`、`Promise.all`）、CSS 自定义属性（变量）+ 媒体查询、`localStorage` 缓存、hash 路由。

---

## 二、目录结构

```
longwaystar.github.io/
├─ index.html                  ← 唯一入口页（单页应用外壳；`<head>` 内联主题初始化脚本，`</body>` 前内联主脚本）
├─ README.txt                  ← 简介与当前版本号（已同步至 RELEASE1.2.4）
├─ lib/                        ← 资源库
│  ├─ css/
│  │  ├─ generalstyle.css      ← 全局：主题变量、布局、侧边栏、卡片、页脚、背景图层、响应式
│  │  ├─ blog.css              ← 博客专属：列表/卡片/筛选/分页/阅读视图/浮动按钮与导航
│  │  ├─ codestyle.css         ← 代码高亮配色：只管 .md-code 里 token 的颜色（布局仍在 blog.css）
│  │  ├─ html.css              ← 卡片内 HTML 的基础排版（.lg-html，配合 lib/js/html.js）
│  │  └─ history.css           ← 历史版本页：RELEASE/BETA 卡片、版本日志视图
│  ├─ js/
│  │  ├─ markdown.js           ← Markdown 渲染器（CommonMark 0.31 + GFM，内置 HTML 白名单清洗）
│  │  ├─ highlight.js          ← 代码高亮器（C / Python / 汇编 / Shell，可扩展）
│  │  ├─ html.js               ← 卡片内 HTML 片段的安全渲染器（白名单清洗 + 挂载 + autoMount）
│  │  ├─ blog.js               ← 博客模块：数据/缓存/列表/阅读视图/导航（渲染器已拆走，只剩薄壳）
│  │  └─ history.js            ← 历史版本模块：清单加载、卡片、版本日志视图、代码复制
│  ├─ icons/                   ← 图标：成对提供 light / dark 两版，按主题自动切换
│  │  ├─ title.ico                          ← 站点 favicon
│  │  ├─ lablesbar_light|dark.png           ← 侧边栏汉堡图标
│  │  ├─ back_light|dark.png                ← 阅读视图返回箭头
│  │  ├─ totop_light|dark.png               ← 回到顶部
│  │  ├─ unfoldnavi_light|dark.png          ← 展开导航
│  │  ├─ foldnavi_light|dark.png            ← 收起导航
│  │  ├─ foldmenu_light|dark.png            ← 文章导航里目录组的折叠/展开（右箭头，展开时转 90°）
│  │  ├─ copy_light|dark.png                ← 复制代码
│  │  └─ pageswitch_light|dark.png          ← 历史版本页的大版本切换（右箭头；左按钮转 180° 表示上一个大版本）
│  ├─ images/404page/          ← 404 页素材：01.jpg（本地图）+ 01.txt（图床地址，优先用）
│  ├─ fonts/
│  │  ├─ 余繁离形体.otf         ← 404 页标题与历史版本大版本号用的字体
│  │  └─ JetBrainsMono[wght].ttf ← 代码字体（变量字体，一个文件覆盖 100~900）
│  └─ documents/               ← 全部"内容数据"（原 words/，已更名）
│     ├─ blogs/                ← 博客数据区
│     │  ├─ list.txt           ← 文章清单（UTF-8 带 BOM；每行一个文章文件夹名 = 文章 id）
│     │  ├─ update_info.bat    ← 数据维护脚本：按 tag.txt 重命名文件夹并重建 list.txt
│     │  ├─ default/           ← 兜底数据（缺 tag.txt / passage.md / cover.png 时逐项降级）
│     │  ├─ c_study_1/         ← 文章：C 语言学习笔记
│     │  ├─ life_in_militrain/ ← 文章：军训经历
│     │  ├─ linux_explore/     ← 文章：Linux 学习笔记
│     │  ├─ risc-v_study_1/    ← 文章：RISC-V 学习笔记
│     │  ├─ site_info_1/       ← 文章：本站的起源
│     │  ├─ site_info_2/       ← 文章：项目结构分析（就是本文）
│     │  └─ test_1/            ← 文章：测试文章（最小样例）
│     ├─ archive/              ← 归档类静态数据
│     │  ├─ historylist/       ← 历史版本数据（清单 txt + 每份日志一个 content.md）
│     │  │  ├─ RELEASE/list.txt        ← 大版本清单（每行一个，如 1.0；新的在上）
│     │  │  ├─ RELEASE/update_list.bat ← 清单维护脚本：按文件夹重建大/中版本 list.txt
│     │  │  ├─ RELEASE/1.0/list.txt    ← 该大版本的中版本清单（如 1.3、1.0；新的在上）
│     │  │  ├─ RELEASE/1.0/1.0/content.md
│     │  │  ├─ RELEASE/1.0/1.3/content.md
│     │  │  └─ BETA/content.md         ← BETA 整份日志（单入口）
│     │  └─ thanks/致谢名单.txt ← 设置页致谢列表数据
│     └─ errorsite/404site/    ← 404 页说明卡片的文案 content.md
└─ othersite/                  ← 独立子站点（与主站无耦合）
   ├─ oldlook/                 ← 旧版主页（保留展示用，已停止维护）
   └─ testground/              ← 空白测试页（Hello World）
```

每篇文章文件夹内部的固定结构（`passage.md` + `info/` 四个可选文件）见 §4.5 的「数据契约」，这里不重复展开。

> 验证方式见第八节，新增文章步骤见附录 A。

---

## 三、页面架构与路由

### 3.1 单页 + 侧边栏标签

`index.html` 是唯一页面，内部用「一个侧边栏 + 六个面板」的结构（四个侧边栏标签；空白页面与 404 没有标签按钮，只能从主页链接或 hash 直达）：

| 标签 | 面板 id | 触发时加载的数据 |
|---|---|---|
| 主页 | `#tab-home` | 无（静态卡片：GitHub / B站 / 其他页面） |
| 我的博客 | `#tab-blog` | `BlogModule.ensureLoaded()`（懒加载） |
| 历史版本 | `#tab-history` | `HistoryModule.ensureLoaded()` → 大/中版本清单 + 日志 content.md（懒加载 + 缓存优先） |
| 设置与相关 | `#tab-settings` | `loadThanks()` → 致谢名单 txt（懒加载 + 缓存） |
| （无标签）空白页面 | `#tab-empty` | 无（预留；主页「关于其他页面」里的「空白页面」按钮 → `#empty`） |
| （无标签）404 | `#tab-404` | 切独立背景（txt 里的图床地址 → 失败退本地图） |

切换逻辑集中在 `index.html` 的 `renderTab(name)`（只切 DOM 与按需加载，**不写 URL**）与 `showTab(name, mode)`（负责历史记录语义）。`showTab` 通过 `window.AppShowTab` 暴露给 `blog.js` 与 `history.js` 复用，避免重复绑定。

> 404 与空白页面都没有对应的侧边栏按钮，所以 `renderTab()` 里对它们做了特判（`TABLESS_TAGS`；否则"没有命中任何标签"会被当成未知标签退回主页）。切到 404 时还会把 `body` 加上 `nf-mode` 来显形独立背景。

### 3.2 hash 路由与浏览器历史

- 标签级：`#home` / `#blog` / `#empty` / `#history` / `#settings` / **`#404`**
- 文章级：`#blog/post/<文章 id>`（收藏夹可直达、可分享）
- **兜底**：既不是合法标签、也不是合法文章的 hash 一律落到 `#404`（用 `replace` 落定地址，不往历史里塞错误页）。

**导航层**（`index.html` 的 `window.AppNav`）：

| 操作 | 语义 | 用到的 API |
|---|---|---|
| 点侧边栏标签 | 用户主动导航 | `history.pushState({navIdx}, '', '#x')` |
| 点文章卡片 | 用户主动导航 | `AppNav.push('#blog/post/<id>')` |
| 首屏初始化 | 不产生可回退项 | `replaceState`（文章级直达时干脆不写 URL） |
| 浏览器前进 / 后退 | 由 `popstate` 重建视图 | 读 `e.state.navIdx` 校准层数 |
| 阅读页「返回」按钮 | 优先真回退 | `AppNav.goBack()` → `history.back()` |

`navIdx` 记录"当前处在第几层站内历史"：只有 `navIdx > 0` 才会执行 `history.back()`，因此**「返回」按钮永远不会把用户带出站点**；对于直达链接（首屏 `navIdx = 0`）则退化为把 hash 换成 `#blog`。文章级 hash 的 `popstate` 由 `blog.js` 独占处理（需要"先开文章再激活标签"，避免主脚本 `ensureLoaded` 抢跑错过缓存命中）。

`popstate` 与 `hashchange` 在前进/后退时会同时触发，`blog.js` 用 `scheduleHandleHash()`（`setTimeout 0` 合并）保证一次跳转只处理一次。

**hash 的两类来源要分开处理**（这里修过几个真 bug）：

- **前进 / 后退** → `popstate`：按 hash 重建视图；文章级 hash 交给 `blog.js`（需要"先开文章再激活标签"）。
- **手动改地址栏 hash** → 只触发 `hashchange`、不触发 `popstate`。所以 `index.html` 的 `hashchange` 监听必须自己把**合法标签**也切过去，否则地址栏成了 `#history`、画面还停在上一个标签。URL 已经就位，切换一律用 `'none'`（不写历史）；**陌生 hash** 才用 `replace` 落成 `#404`。
- **清空 hash**（把地址栏里的 `#…` 删掉）按**首页**处理，不再落 404。
- **文章 id 不存在**：`blog.js` 的 `handleHash()` 先 `openPostById()`，`goNotFound()` 这时已经把 hash 换成 `#404`、把 404 面板切了出来；因此后面**必须跳过"激活博客标签"**这一步，否则 404 会被盖回博客列表（URL 停在 `#404`、视图却是列表）。判断依据就是"`openPostById()` 返回后 hash 还是不是文章级"。
- **直达文章加载慢时用户切走**：`onTabShown(name)` 在 `name !== 'blog'` 时清空 `pendingPostId`；否则加载结束时会把 URL `replace` 回 `#blog/post/<id>`、并把阅读视图塞给一个已隐藏的面板。
- **畸形百分号编码**（如 `#blog/post/%E0%A4`）：`currentPostId()` 对 `decodeURIComponent` 做了 try/catch，解不开就按原始串查文章 → 自然走"文章不存在 → 404"，不会抛 `URIError` 把整条路由打断。
- 切到非博客标签时把 `document.title` 还原成 `LongwaySite`，免得标签页一直挂着上一篇的标题。

---

## 四、功能模块逐个拆解

### 4.1 主题（三态：跟随浏览器 / 固定亮色 / 固定暗色）

- 实现方式：`data-theme` 属性挂在 `<html>` 上，`generalstyle.css` 里 `:root` 与 `[data-theme="dark"]` 各自定义一整套 CSS 变量（`--bg-body`、`--bg-card`、`--text-primary`、`--border-color`、`--cyan-500`/`--cyan-300` 等）。所有组件只引用变量，因此换肤零成本。
- **三种模式**（同时写到 `data-theme-mode` 便于调试与样式挂钩）：
  | 模式 | 何时进入 | localStorage `theme` |
  |---|---|---|
  | `auto`（默认） | 默认状态；点设置页「跟随浏览器主题」 | 键被删除 |
  | `light` / `dark` | 点侧边栏主题按钮固定 | 存 `'light'` / `'dark'` |
- **打开网页时自动匹配浏览器**：初始化脚本位于 `index.html` 的 `<head>` 中、CSS 之前同步执行（`window.AppTheme`），`auto` 模式下读 `prefers-color-scheme` 决定亮暗，因此**首屏就是正确主题，不会闪烁**。
- **实时跟随**：`auto` 模式下监听 `matchMedia('(prefers-color-scheme: dark)')` 的 `change`，系统主题一变页面立刻跟着变；一旦手动固定就停止跟随。
- 侧边栏 `.theme-toggle`：在 `auto` 下取当前生效值的**反色**作为显式选择（即"现在深色 → 点一下固定为浅色"）；设置页「关于主题」卡片显示当前状态并提供**「跟随浏览器主题」**按钮回到 `auto`。状态文案由 `updateThemeUI()` 维护，站主润色后为：跟随态显示「当前已跟随浏览器主题」，固定态显示「当前主题已更改，点击下方按钮恢复自动切换」（**只提示状态迁移，不再复述具体是深色还是浅色**——具体色号由侧边栏按钮的图标与文案承担）。
- **图标随主题自动切换**：图标资源按"两版一套"命名，**文件名里的 `light` / `dark` 指图标自身的颜色，不是主题名**——所以约定是「亮色主题（浅背景）配 `_dark` 图标，暗色主题（深背景）配 `_light` 图标」。实现方式是纯 CSS：在 `generalstyle.css` 的 `:root` 与 `[data-theme="dark"]` 里成对登记变量（`--icon-nav`、`--icon-back`），组件只写 `background-image: var(--icon-nav)`，主题一变换图标立即跟着变，**不需要任何 JS**（也因此不会有首屏闪错颜色的问题）。
  > 坑：`background` 简写会把 `background-image` 一起重置。`.blog-back` 原本写的是 `background: var(--bg-glass)`，改用图标背景后必须先改成 `background-color`，再写 `background-image`。


### 4.2 侧边栏收起 / 展开

- `.sidebar-toggle` 按钮切换 `.layout.collapsed` 类，CSS 用 `width/margin-left` 过渡实现动画。
- 桌面端记忆到 `localStorage.sidebarCollapsed`；≤640px 时侧边栏变顶部横向栏（CSS 媒体查询），JS 用 `isDesktopSidebar()` 判断，移动端不读取收起记忆。

### 4.3 背景（随机壁纸）

**来源**：第三方 API `https://api.yppp.net/api.php`（常量 `WALLPAPER_API`）。它是一个**随机壁纸入口**——每次请求都 302 跳到另一张图（跳转链：`api.php` → `302 pc.php` → `302 https://list.yppp.net/d/image/<hash>.{webp,png,jpg}`），所以**入口地址本身不能当壁纸地址**，必须先解析出跳转后的固定链接。

**显示方式**：独立的「背景图层」`<div class="bg-layer" id="bgLayer">`，JS 只改它的 `background-image`。

| CSS 属性 | 值 | 作用 |
|---|---|---|
| `position` / 宽高 | `fixed` + `inset` 铺满 | 与视口同尺寸 |
| `z-index` | `-1` | 垫在所有内容后面 |
| `background-size` / `-position` | `cover` / `center` | 居中裁切铺满 |
| `pointer-events` | `none` | 纯装饰层，空白处的点击与"从空白处起手的文本选择"都落到页面本身 |

- **为什么用背景层而不是 `<img>`**：背景不会被选中/拖动，加载失败也**不会露出破图占位**（失败时只是这一层不显示，底下 `body` 的 `--bg-body` 纯色兜着）。
- **HTML 里特意不写默认壁纸**：交给 JS 解析出真实固定链接后**一次铺上**，避免"先下一张随机图、再换成另一张"白费好几 MB 流量。代价是首屏有短暂纯色底色。

**刷新流程**（`refreshBackground()`；侧边栏的「刷新背景」与设置页的按钮都调它）分三级降级：

| 级别 | 条件 | 做法 | 结果 |
|---|---|---|---|
| ① | 能解析出跳转后的地址 | `resolveWallpaperRedirect()` 用 `HEAD`（`redirect:'follow'`）读 `response.url`；HEAD 不被支持就退回 GET，并在拿到地址后立刻 `AbortController.abort()`。先 `preloadImage()` 预热再铺图 | `resolved = true`，**当前 API 走的就是这一级** |
| ② | 没重定向 / 解析不到 | 直接 `fetch` 成 blob，用同源 object URL 当背景（字节已经在手里） | `resolved = true` |
| ③ | 连 CORS 都没有 | 把随机入口地址原样当背景铺上 | `resolved = false`（能看，但读不到字节） |

**获取当前壁纸**（`saveCurrentWallpaper()`）分两条路，**都不会给出"和屏幕不一样"的图**：

- **能拿到字节时**（`resolved = true`，当前 API 的正常情况）→ 脚本一键下载，文件名形如 `wallpaper-2026-09-28-153012.png`：已经取过 blob 的直接落盘，否则按**真实固定链接** `fetch` 成 blob，再用同源 blob URL + `<a download>` 触发下载（跨域 URL 直接挂 `download` 会被浏览器忽略）。**保存格式统一为真正的 PNG**（`blobToPng()`：源图不是 PNG 时用 canvas 重编码——只改后缀不算转格式；转不动就按原格式保存并说明）。
- **拿不到字节时**（将来又换成不发 CORS 的图床才会走到）→ 只如实说明"无法取出与屏幕一致的原图"，**绝不**给一张错图。
- 各种结果都会写在卡片的状态行（`#bgStatus`，`.card-status`，为空时 `:empty` 自动不占高度）。

**踩坑记录（都在这里踩过一遍）**

1. **`img.currentSrc` 不等于重定向后的地址**——它只是"当前选中的源"，没写 `srcset` 时就等于你设进去的原始 URL。早期版本据此记录壁纸地址，导致"渲染的背景"和"下载的图"各请求一次随机入口、拿到两张不同的图。
2. **图床不给 CORS 头就什么都读不到**：老图床 `t.alcy.cc` 带 `Origin: https://longwaystar.github.io` 请求时 `Access-Control-Allow-Origin` 仍为 `null`，浏览器端 `fetch` 读它的字节一定被拦下，脚本一键下载在那张图床上**根本不可能**。（当时试过第三方 CORS 代理：`wsrv.nl` 不可达、`allorigins` 超时、`corsproxy.io` 要 API key，都不适合当依赖，因此**没有引入任何代理**。）现行 API `api.yppp.net` 整条跳转链都带 `Access-Control-Allow-Origin: *`（连中间两个 302 都有），所以 `fetch` 既能读到固定链接、也能读到图片字节——**换 API 时并没有改逻辑**，那套写法本来就在，只是被老图床的 CORS 掐死了。
3. **右键另存兜底的兴衰**：中间曾把壁纸改成 `<img>` 图层，专为"读不到字节时让用户右键存原图"（那时**不能**设 `pointer-events:none`）。换成有 CORS 的 API 后一键下载成为主路，这套「保存模式」既不可能生效又容易误导，已随 `<img>` 一起移除。
   > **换图床的第一件事：确认它带 `Access-Control-Allow-Origin`**，否则一键下载会退化。

### 4.4 历史版本 / 致谢名单

历史版本页是独立模块（`lib/js/history.js` + `lib/css/history.css`，与 `blog.js` 无耦合，只复用 Markdown 渲染器与代码高亮）；致谢名单仍是 `index.html` 里的轻量逻辑。两者都遵循「**缓存优先 + 静默更新**」：先读 `localStorage` 立即渲染，再 `fetch(url, { cache: 'no-store' })` 拉最新内容，成功后写缓存并重渲染（失败时无缓存才报错）。

**历史版本页结构**

- 面板 = 横跨整宽的标题卡「历史版本列表」+ `#historyCards`（两张卡片，**RELEASE 在上、BETA 在下**）+ `#historyRead`（日志视图，默认 `hidden`）。
- BETA 卡：标题「BETA版本」→ 分割线 → 单条入口「BETA 版本历史」（`BETA/content.md` 是整份日志，不显示大版本号）。
- RELEASE 卡：标题「RELEASE版本」→ 大版本行（`.history-big` 用 `@font-face` 的 `'YuFanLiXing'`（余繁离形体.otf）；右侧 `.history-big-switch` 横向两个按钮用 `--icon-pageswitch` 的 `::before`（图标本身是右箭头）：左按钮转 180° 成「<」= **上一个大版本**（版本号更小、更早），右按钮原样「>」= **下一个大版本**（版本号更大、更新），**没有对应版本时该按钮不渲染**；切换后内容按翻页方向滑入（`.is-paging` + `--page-shift` ±16px，`history-page-in` 240ms））→ 分割线 → 中版本列表（每行一个按钮，行间 1px 线；顺序与清单一致，新的在上）。大版本默认选第一个（最新），切换只改 `state.release.index` 重渲染，**不写 URL**。
- 点中版本 → 在面板内切到日志视图（**不新增 hash 路由**，避免动 §3.2 的路由与 404 回退）：`#historyCards` 像博客列表一样整体隐藏（CSS 里有 `.history-cards[hidden]{display:none}`，否则它的 `display:flex` 会盖掉 `hidden` 属性）。日志卡头部左侧是标题（`#historyReadTitle`，RELEASE 写中版本号，如「1.3版本」；BETA 写「BETA 版本历史」），右侧是**返回版本列表**按钮（`.history-back`）；**没有日志导航面板，也没有任何浮动按钮**——正文按普通阅读流往下滚，要换版本就点右上角返回。正文由 `LongwayMarkdown.render(md, mdOptions(dir))` 渲染，代码块沿用高亮与「已复制！」反馈。**不再生成「RELEASE 1.0 · 1.3 / RELEASE 1.0 系列」这类复合标题与副标题**（标题栏只保留中版本号），也不改 `document.title`（返回时统一复位成 `LongwaySite`）。
- 日志加载与博客同款：先读 `LongwaySiteHistoryDocsV1` 缓存立即渲染，再静默 `fetch` 比对原文（相同则不重渲染）。

**数据契约（清单 + content.md）**

```
lib/documents/archive/historylist/
├─ RELEASE/list.txt          ← 大版本清单（每行一个，如 1.0；新的在上）
├─ RELEASE/update_list.bat   ← 双击重建全部 list.txt（见下）
├─ RELEASE/<大版本>/list.txt ← 该大版本的中版本清单（每行一个，如 1.3、1.0；新的在上）
├─ RELEASE/<大版本>/<中版本>/content.md
└─ BETA/content.md           ← BETA 整份日志（只有这一个入口）
```

- **排序约定：新的在上**。两份 `list.txt` 都按版本号从大到小（`1.10` 排在 `1.9` 前面，按数字段比较），页面也按同一顺序显示，默认展示最新的那个大版本。
- 静态站不能列目录，所以清单是唯一入口：**新增大版本要往 `RELEASE/list.txt` 加一行，新增中版本要往 `RELEASE/<大版本>/list.txt` 加一行**，否则卡片上看不到（日志文件本身加了也没用）。
- **自动维护**：双击 `lib/documents/archive/historylist/RELEASE/update_list.bat`，它扫描 `RELEASE` 下的文件夹重建大版本清单，再逐个扫描 `<大版本>/` 下含 `content.md` 的文件夹重建中版本清单，统一写「新的在上」、UTF-8 无 BOM、CRLF；没有 `content.md` 的大版本文件夹会被跳过并在窗口里提示（避免半成品进清单）。BETA 不参与，仍是单份 `BETA/content.md`。
- 日志正文是通用 md（`content.md`，无时间信息），与 404 说明卡片同一种加载方式（见 §4.10）。

**致谢名单**

设置页的「致谢」卡片：`loadThanks()` 先读缓存 `LongwaySiteThanks` 立即渲染，再 `fetch('lib/documents/archive/thanks/致谢名单.txt')` 静默更新；失败时有缓存则保留旧内容。

- **编码约定（实测确认）**：`blogs/list.txt` 带 UTF-8 BOM（由 `update_info.bat` 写出，`blog.js` 用 `trim()` 顺带吃掉 BOM）；`tag.txt`、`passage.md`、`info/cover.txt`、`archive/historylist/**/list.txt`、`archive/historylist/**/content.md`、`致谢名单.txt` **都不带 BOM**。手工编辑这些文件时请保持 UTF-8 无 BOM，否则 `tag.txt` 第 1 行的标题会带上不可见字符。（`cover.txt` 的解析对 BOM 宽容——`pickCoverLink()` 会 `trim()` 每一行，BOM 会被当作空白吃掉。）

### 4.5 博客模块 `lib/js/blog.js`（项目核心）

#### 数据契约

`lib/documents/blogs/list.txt`：每行一个文章文件夹名（空行忽略；`default` 与历史遗留名 `.Default` 均被过滤）。

每篇文章文件夹：

```
<文章文件夹>/
├─ passage.md          正文（可选；缺失时取 default/ 兜底）
└─ info/
   ├─ tag.txt          元数据，5 行（缺失行逐行用 default/ 兜底）
   ├─ time.txt         时间数据（缺失时整体用 default/ 的时间）
   ├─ cover.png        列表封面（可选；加载失败时由卡片 <img> 逐级降级：本篇 cover.png → default 封面）
   └─ cover.txt        封面外链（可选，一行 http(s) 地址；写了就优先用它，**default/ 不参与**）
```

`default/` 兜底目录（同样遵循上面的结构，tag.txt 只有前两行——后面的行留空，这样缺作者/主题的文章不会被塞进假数据）：

```
default/
├─ passage.md          ← 提示"内容缺失"的说明性正文
└─ info/{tag.txt, time.txt, cover.png}
```

`tag.txt` 行序：

| 行 | 含义 | 备注 |
|---|---|---|
| 1 | 标题 | 前导 `#` 会被去掉 |
| 2 | 描述 | 列表卡片摘要，最多显示 2 行 |
| 3 | **作者** | 多位作者以空格分隔（全角空格也兼容）；列表卡片只显示第一位，阅读视图显示全部 |
| 4 | 主题 | 会去掉前导 `#`，用于主题胶囊与精确筛选 |
| 5 | 文章 id | 缺失时由文件夹名生成 `post_<净化后名字>`；也是 `update_info.bat` 重命名文件夹的目标名 |

`info/time.txt` 行序 —— **时间格式统一为紧凑写法 `YYYYMMDD`**（例：`20260928`），显示时转成 `xxxx年x月x日`：

| 行 | 含义 | 备注 |
|---|---|---|
| 1 | 撰写时间 | 例 `20260926` |
| 2 | 固定空白 | 分隔用；解析时对所有空行都宽容跳过 |
| 3 起（若存在） | 修改时间 | 已按时间升序排好，显示时无需再排序 |
| 最后一行 | 最新编辑时间 | 没有任何修改行时就等于撰写时间 |

- 解析规则（`parseTimeText()`）：`created` = 第 1 行；`editTimes` = 第 2 行起的全部非空行（升序）；`latest` = `editTimes` 的最后一项，为空则退化为 `created`。
- **按时间排序依据 `latest`**（最新编辑时间），不是撰写时间。
- 缓存校验也以 `latest` 为唯一依据（见下方加载流水线）。
- 封面 URL 会带上 `?v=<latest>`：文章一更新，URL 就变，浏览器必定重新取图——这就是"重载文章时封面一起刷新"的实现方式。

#### 封面外链 `info/cover.txt`（可选机制）

- 文件里写**一行 `http(s)` 绝对地址**即可把这张外链图当封面。`pickCoverLink()` 会跳过空行与 `#` 开头的注释行、去掉首尾空格；第一行不合规就接着看下一行；一行可用外链都没有就**回落到约定路径的 `cover.png`**。只认带协议的绝对地址——`www.example.com/a.png` 这种缺协议的会被判为格式错误。
- **`default/` 不参与**：该目录即使放了 `cover.txt` 也会被忽略（源码里由 `if (folder !== DEFAULT_FOLDER)` 守卫）。
- **不做链接有效性探测**（探测要整张下载图片，浪费流量）。有效性交给卡片 `<img>` 的 `onerror` **逐级降级**：外链 → 本篇 `cover.png` → `default` 兜底封面。降级用阶段标记推进，**最多换两次**——否则两边都失败时会在 `cover.png` 与 `default` 之间来回跳。
- **缓存语义**（这条最关键）：`cover.txt` 只在**文章需要重新加载时**读一次，读到的结果随文章一起写进缓存（就是 `cover` 字段）。所以**缓存命中时直接用缓存里的封面，不会再读 `cover.txt`、更不会去加载链接**；只有文章过期（`time.txt` 的最新编辑时间变了）触发重载时，才会重读 `cover.txt` 并采用新链接。换句话说：**改了 `cover.txt` 必须同时更新 `info/time.txt`，封面才会刷新**。
- 外链地址**原样使用、不追加 `?v=`**（带签名的图床加了参数可能失效）；本地 `cover.png` 那条路仍然带 `?v=最新编辑时间`。

#### 加载流水线（`ensureLoaded()`）

```
读 localStorage 缓存(LongwaySiteBlogV1)
   ├─ 命中 → applyCache()：立即渲染列表/统计；若是直达文章再直接 openArticle(a, 'none')
   ↓
fetch list.txt（轻量）
   ├─ 失败 → 有缓存则继续用缓存，无缓存则显示"加载失败"
   └─ 成功 → fetchLatestTimes(ids)：逐篇取 info/time.txt（极小文件），得到每篇的 latest
        ↓
逐篇比对缓存（关键：只重载"变了"的那几篇）
   ├─ 缓存无此 id（新文章）           → 需要加载
   ├─ 缓存里没有 latest（旧版缓存）    → 需要加载
   ├─ latest 与缓存不一致（文章更新）  → 需要加载（连封面一起刷新）
   └─ 一致                            → 直接沿用缓存（不重取正文、也不重取封面）
        ↓
needLoad 为空 → 不显示进度条、不发任何正文请求，只回写缓存以剔除已删除的文章
needLoad 非空 → setProgress() 显示进度条
        ↓
loadArticles(needLoad)：有界并发（CONCURRENCY = 4）逐篇 loadArticle()
   ├─ 进度回调 setProgress('determinate', …, pct)（封顶 99%）
   ├─ 首次加载时每成功一篇就 renderLoading() 增量上屏（无筛选/排序时才启用）
   ↓
全部完成 → 覆盖 articles、重建 idMap、writeCache()、hideProgress()、renderList()、bindFilter()
   └─ 若存在 pendingPostId（hash 直达）→ 用最新数据 openArticle(a, 'none') 或回列表
```

设计要点：**首屏快**（缓存直出）、**省流量**（只有 `latest` 变了的文章才重取，未变动的一篇都不重取）、**最终一致**（以最新编辑时间为唯一依据，文章一改就会被发现）。

#### 页面布局（宽屏两列 / 手机单列）

- 所有标签共用 `lib/css/generalstyle.css` 的 `.container`：`max-width: 75vw`。外层 `.main` 已经限死了可用宽度，所以 `75vw` 大于可用宽度时会自动退化成 100%；`≤640px` 再补一条 `max-width: none`，手机端就是满宽。
- 博客标签的 DOM：`section#tab-blog` 依次是 `header.blog-header`（标题卡，**横跨整宽**）、`#blogLayout.blog-layout`（CSS Grid 两列：左列 `#blogBrowse` 内容卡，右列 `aside#blogFilterPanel`，固定 220px、`position: sticky; top: 1.2rem`）、`#blogPager`（分页器，在布局之外、内容区下方）。标题卡与内容卡同宽同左缘，列表卡与标题卡左右缘都对齐；75% 的宽占比把右列也算在内。
- 右列卡片的顶线：`≤820px` 变成单列时才有意义的是"筛选卡落到列表下方"；桌面态筛选卡**与左侧内容卡 `#blogBrowse` 顶边齐平**（同一个 grid 行、`align-items: start`，不需要任何 margin 补偿）——它比标题卡低一截，不会高过标题卡。停靠后的文章导航同理：与内容卡（阅读卡）同顶。
- 阅读视图里筛选卡会被 `display: none`，脚本同时给 `#blogLayout` 加 `is-reading` 类：默认收成单列（不让右侧空着 220px）；但**宽度够（`≥1024px`）时右列不空着，而是把文章导航 `#readNav` 停靠进去**，与阅读卡同顶（详见 §4.5「阅读视图」的文章导航条目）。
- `≤820px` 网格变单列（`row-gap: 1.5rem`），筛选卡改为 `position: static`，落到文章列表下方；分页器排在最后（与旧版手机端顺序一致）。

#### 筛选 / 排序 / 分页

- 状态为模块级变量：`filterName`（模糊，匹配标题或文件夹名）、`filterAuthor`（模糊，匹配任意一位作者名）、`filterTheme`（**精确**匹配）、`sortKey`（默认 `'name'`，可切 `'time'`）、`sortDir`、`page`。排序按钮**始终有一个高亮的字段**，再点高亮的按钮不改变排序；切换字段会保留已选的升/降序。
- 三项筛选是**与（AND）关系**，同时生效；优先级：主题精确 → 名称模糊 → 作者模糊 → 排序。三个输入框共用同一个 200ms 防抖。
- 作者匹配规则：对该文章的**每一位**作者做不区分大小写的子串匹配，命中任意一位即算命中（多作者文章不会因为只搜其中一位而漏掉）。
- 「重置」按钮会把三个输入框与筛选状态一并清空；点主题胶囊等于"只看这个主题"，也会顺手清掉名称与作者筛选（避免叠加后出现意料之外的空结果）。
- 排序：名称用 `localeCompare(…, 'zh-CN')`；**时间用 `timeStamp(a.latest)` 即最新编辑时间**。
- 分页：`PER_PAGE = 10`，`renderPager(pages)` 生成「‹ 1 2 3 ›」式分页器（含首尾禁用态）；**不满一页（含 0 结果）时整块隐藏**。
- 列表小卡片显示：`标题 + 第一位作者 + 最新编辑时间`；右下角主题胶囊是绝对定位的，所以描述区留了右侧通道以免被压住。
- **作者名可点击**（`setFilterByAuthor()`）：列表卡片上点第一位作者、或阅读视图里点任意一位作者，都会直接筛出该作者的文章——行为与点主题胶囊对称（清掉另外两项筛选、把名字填进作者框、回到列表并滚到筛选区）。卡片是 `<a>`，所以处理里必须 `stopPropagation()`（别让卡片当成"打开文章"）＋ `preventDefault()`（阻止链接跳转）；卡片自身的点击处理也加了 `.blog-item-author` 的提前返回作双保险。阅读视图的作者是**逐个**渲染的 `.author-link`，多作者文章点谁就筛谁。

#### 阅读视图

- `openArticle(a, mode)`：隐藏列表/筛选区/分页器，显示 `#blogReadView`，把 URL 换成 `#blog/post/<id>`，并把网页标题改成 `LongwaySite-<文章标题>`；正文由 `renderMarkdown(a.body, a.folder)` 渲染。`mode` 见 §3.2：`'push'`（用户点卡片，默认）或 `'none'`（URL 已就位：直达链接 / 前进后退）。
- 元信息一行：**撰写时间：** → 主题胶囊 …… 最右侧是 **作者：** 与 **修改时间：**（`.blog-read-byline` 用 `margin-left:auto` 推到最右）。三项都是「标签：值」结构（`.meta-label` + `.meta-value`）：标签小字灰、值正常色。
  > **窄屏必须允许这组换行**（修过的 bug）：byline 若保持 `nowrap`，"作者：… 修改时间：2026年11月21日" 会整块顶出卡片，页面能向右滑（320px 实测溢出 25~100px）。现在的做法：`.blog-read-meta` / `.blog-read-byline` 都加 `min-width: 0`，byline 允许 `flex-wrap`，作者名与日期再用 `overflow-wrap: anywhere` 兜底；≤600px 时整组单独占一行。
  > **修改时间只在确实存在修改记录时才出现**：`time.txt` 只有一行（没有修改行）时，这项整块不渲染（`editTimes.length === 0` 就跳过）。
- **修改时间上的浮动提示框**：鼠标移入（或键盘聚焦 / 触屏点击）弹出 `.edit-tip` 玻璃小卡片，列出**最近五条编辑记录**（不足五条则全部显示；`editTimes` 升序取末尾 5 条再倒序 → 最新在最上）。由 `buildEditTip()` 构建、`closeEditTips()` 统一收起（点别处或离开文章时），显隐用 opacity + transform + visibility 过渡，风格与右下角浮动按钮一致；触屏下点击触发元素开合（`stopPropagation`，免得被全局收起逻辑立刻关掉）。
- `closeArticle()`：反向操作，标题恢复 `LongwaySite`，hash **替换**回 `#blog`，并清空 `pendingPostId`（用户主动返回即放弃直达目标）。
- 直达两种路径：缓存命中 → 立即阅读（无进度条）；未命中 → `enterReadingPlaceholder(id)` 先显示骨架 + 不确定态进度条，加载完成后填充。
- **右下角浮动按钮**（`#readFab`，DOM 挂在 `<body>` 下）：竖排两组 —— 上方是**常驻**的「展开导航」(`#fabNav`)，下方是一个 `.read-fab-extra` 分组，装着「返回」(`#fabBack`) 与「回到顶部」(`#fabTop`)。显隐规则由 `updateReadFab()` 判定，三个类各管一段：
  - `.read-fab.visible` —— 只看"是否处于阅读视图"（阅读容器可见 **且** 博客标签激活）。**导航按钮要常驻，所以不能跟着滚动位置忽隐忽现**；
  - `.read-fab-extra.hidden-extra` —— 才看"文章标题是否已滚出视口上方（`#blogReadTitle` 的 `getBoundingClientRect().bottom < 0`）"，只有这两枚按钮受滚动影响；
  - `#fabNav.is-hidden` —— 不在阅读视图、或导航已展开时淡出，并且**把 `max-height` 与 `border-width` 一起收掉**（否则会在原位留一条边框细线），这样浮层会平滑滑到按钮原来的位置上，不会空出一格。
  > 两个容易踩的样式细节：① `.read-fab-extra` 因为要做"高度归零"的收起动画必须带 `overflow: hidden`，所以要额外加 `padding-top: 3px` 给 `.read-fab-btn:hover` 的 `translateY(-2px)` 留余量——**不留就会把最上面那枚按钮的顶边裁掉一条**（收起的 `.hidden-extra` 里再把这份余量归零，免得留下空隙）；② 按钮**不设 `box-shadow`**，贴着内容区右下角时投影会显成"按钮下方一层灰"，立体感交给边框与悬停变色。
  滚动用 `requestAnimationFrame` 合并更新；**窗口 `resize` 直接调 `updateReadFab()`**（不走 rAF：停靠/回浮层要跨阈值立刻落位，后台标签里 rAF 还可能暂停）；返回/回到顶部共用 `handleBackAction()` 与 `backToTop()`。
  > 为什么按钮不放在 `.blog-browse` 里：该容器带 `backdrop-filter`，会让 `position: fixed` 的包含块退化成它本身，按钮就不再相对视口固定了——所以浮动按钮必须挂在 `<body>` 下。同理，`.blog-back` 与浮动按钮的图标都改用 `background-color` + `background-image`，避免 `background` 简写把图标重置掉。
- **文章导航浮层**（`#readNav`，默认放在按钮组内部，`right:0` + `bottom:100%` 所以是**朝左上展开**）：
  - **宽屏常驻（停靠）**：进入阅读视图且视口 `≥1024px` 时，`placeReadNav()` 会把整个 `#readNav` **物理挪进 `#blogLayout` 当右列卡片**（`grid-column: 2; grid-row: 1`），样式由 `@media (min-width: 1024px) .blog-layout.is-reading > .read-nav` 接管：`position: sticky; top: 1.2rem`、`width: 100%`、常显（`opacity/visibility` 直接置为可见、过渡关掉）、`max-height: min(62vh, 26rem)`；因为与阅读卡在同一个 grid 行、`align-items: start`，**顶边天然与内容卡齐平**（没有额外 margin）。同时隐藏右上角的「收起导航」按钮、隐藏右下角「展开导航」按钮（`#fabNav`），也**不走 3 秒自动收起**、滚动页面不会把它收掉——它现在是右列的常驻卡片。
  - **窄屏回按钮**：视口变窄到 `<1024px`，或退出阅读视图时，`placeReadNav()` 把导航挪回 `#readFab`，恢复成原来的「展开导航」按钮 + 浮层（带收起按钮、滚动/3 秒自动收起）。
  - 阈值写了两处，**必须成对改**：CSS 的 `@media (min-width: 1024px)`（`blog.css`）与脚本的 `READ_NAV_DOCK_QUERY = '(min-width: 1024px)'`（`blog.js`）。脚本还用 `matchMedia(…)` 的 `change` 监听跨阈值时立刻换宿主，窗口 `resize` 也直接重算（不走 rAF），所以拖窗口时导航会即时落位，不会停在错的一半。
  - 取舍：`1024px` 停靠时左列只剩约 463px 正文宽（一行约 29 个汉字），`1023px` 回浮层反而有 706px。想更早/更晚停靠就改上面那两处阈值（建议一起改到同一个值）。
  - `buildReadNav()` 在每次 `openArticle()` 后按正文里的 **h1 / h2 / h3** 建目录树——标题本身没有 id，这里统一补上 `read-heading-N`，目录项用 `data-target` 指过去；三级用 `.lvl-1/2/3` 区分字号与颜色，层级缩进由嵌套容器 `.read-nav-children` 负责（左侧还有一条竖线画层级）；**一个标题都没有时显示「暂无标题」**。
  - **可折叠**：某个标题下面有子标题时，`buildReadNav()` 会给它补一个折叠按钮（`.read-nav-toggle`，图标是 `foldmenu_*`（右箭头）；展开时顺时针转 90° 朝下、折叠时朝右），点击只切换子容器上的 `.collapsed`（`display:none`，**不重建 DOM**），不会触发跳转；折叠状态下点标题本身仍能正常跳转。默认全部展开。
    > 这些 id 是**渲染时临时生成**的，别在正文里写 `#read-heading-3` 这类锚点链接——hash 路由会把 `#...` 当成站内路由处理，跳转会跑偏。
  - 点目录项 → `jumpToHeading()` → `scrollIntoView({behavior:'smooth', block:'start'})`；顶栏避让交给 CSS 的 `scroll-margin-top: 4.5rem`（手机上侧边栏是 sticky 顶栏）。跳转后浮层**保持展开**，由用户自己收起。
  - 浮层右上角是「收起导航」小按钮（`#readNavFold`，用 `foldnavi_*` 图标），点它回到「展开导航」状态；`aria-expanded` 随之同步。**展开期间「展开导航」按钮隐藏**，由这个收起按钮接手。
  - **展开状态不做任何记忆**，且展开后会**自动收起**（`READ_NAV_AUTO_CLOSE_MS = 3000`）：① 用户一滚动页面就立刻收起（滚动监听里 `isReadNavOpen()` 为真时调 `setReadNavOpen(false)`；浮层**内部**目录列表的滚动事件不冒泡到 window，所以翻目录不会误收）；② **鼠标指针不在浮层内、持续满 3 秒**才收起——指针进入浮层（含内部目录项，`pointerenter`/`pointerleave` 会考虑子元素）时 `clearReadNavTimer()` 暂停倒计时，离开后 `startReadNavIdleTimer()` 重新计满 3 秒；收起时会把 `readNavPointerInside` 标志一并清零，否则"指针在浮层里被滚动收起"之后，下次展开会因标志残留而**永不倒计时**。**宽屏停靠时不走这套**：`setReadNavOpen()` 与 `startReadNavIdleTimer()` 都在 `isReadNavDocked()` 为真时提前返回，导航既不会被滚动收起，也不计时。
    > **手机上呢？** 按时间收起**只在能悬停的设备**（`matchMedia('(hover: hover) and (pointer: fine)')`）上启用。触屏不按时间收起——手机上没有"指针停在哪"的概念，看着目录突然被收掉很烦；手机端由用户手动点「收起导航」或滚动页面来关闭。指针暂停同理只在桌面生效（触屏上 `pointerenter` 会随手指按下触发、`pointerleave` 又常常不派发，硬按桌面逻辑走会出各种怪象）。
    > 换文章、返回列表、切走标签同样会收起。
  - **动画**：浮层显隐**不用 `hidden` 属性**（那是 `display:none`，做不了过渡），改用 `.open` 类 + opacity/transform/visibility 过渡（收起时 `visibility` 延迟到过渡结束再切换，保证淡出能播完）；`.read-fab-extra` 收起时会连 `max-height` 一起动画，所以「返回/回到顶部」出现或消失时，导航按钮不会突然跳位。
  - **目录条的"腰斩"问题**（标题多、需要滚动时，滚出边界的那条只露出上半截字）：三处一起解决 —— ① `.read-nav-item` 加 `flex-shrink: 0`，防止 flex 列把条目压扁；② 滚动区 `.read-nav-list` 底部加渐隐 `mask-image`，越界的那条**淡出**而不是被硬切；③ `scroll-snap-type: y proximity` + 条目的 `scroll-snap-align: start`，停下时对齐到条目边界，再配一点 `padding-bottom` 留余量。

#### Markdown 渲染器（`lib/js/markdown.js` + `lib/js/highlight.js` + `lib/css/codestyle.css`）

**分层**：解析、高亮、配色各管一摊，`lib/js/blog.js` 里只剩下两个薄壳函数：

| 文件 | 职责 |
|---|---|
| `lib/js/markdown.js` | CommonMark 0.31 + GFM 的解析与渲染；内置原始 HTML 白名单清洗；对外 `LongwayMarkdown.render(md, opts)` / `renderInline(text, opts)` |
| `lib/js/highlight.js` | 代码高亮：把源码切成 `<span class="tok-*">`；对外 `LongwayHighlight.highlight(code, lang)` / `canonical(lang)` |
| `lib/css/codestyle.css` | 只管 token 颜色（VS Code Light+ / Dark+ 两套 `--code-*` 变量），代码块布局仍在 `blog.css` |
| `lib/js/blog.js` | `renderMarkdown()`：注入"文章文件夹"与 URL 安全校验，其余全交给上面三个文件（旧的卡片专用渲染器已删除，404 卡片直接调 `LongwayMarkdown.render()`） |

> 加载顺序不能乱：`index.html` 先引 `markdown.js`、`highlight.js`，最后才是 `blog.js`。渲染器找不到高亮器时会自动退回纯转义（能看、能复制，只是没颜色），所以少引一个文件不会白屏。

**两段式解析**（这是与旧版"逐行正则"最根本的区别）：

1. **块级**：先把全文切成块树（段落 / 标题 / 引用 / 列表 / 代码 / 表格 / HTML 块）；
2. **行内**：对每个块的文字跑 CommonMark 的**定界符栈**算法，算强调与链接的配对。

旧渲染器的坑基本都出在"没有块结构"：列表靠缩进猜、引用逐行拼 `<br />`、HTML 逐行清洗把 `<details>` 补成闭合、强调用正则递归在 `**a*b**` 这类写法上错配。块树 + 定界符栈把这些问题从根上解决。

**支持的语法**（按规范实现）：ATX / Setext 标题、段落与软硬换行、引用（可嵌套、可惰性续行）、无序/有序列表（可嵌套、可指定起始编号、紧凑/松散）、任务列表（GFM）、围栏代码块（信息串任意，含空格与中文）、缩进代码块、分割线、GFM 表格（对齐；反引号里的竖线不切分、`\|` 显示为字面竖线）、原始 HTML 块（7 类启动条件）、行内代码（任意等长反引号串）、强调/加粗（侧翼规则 + 规则三）、删除线、链接与图片（行内式 / 引用式 / 简写引用式）、自动链接（`<http://…>`、`<a@b.cn>`、裸 `http(s)://`）、反斜杠转义、HTML 实体、行内原始 HTML、链接引用定义。

**与旧渲染器相比的行为变化**（改文章时值得知道）：

- **连续非空行合并成一个段落**：旧版"每行一个 `<p>`"，现在按规范用空行分段，段内换行是软换行（显示为空格）。要强制换行就写行末两个空格或行末 `\`。
- **松散列表会出现 `<p>`**：列表项之间夹了空行，整条列表判为"松散"，每项内容包进 `<p>`，上下间距略大；贴紧着写的列表仍是紧凑的（不包 `<p>`）。这是规范判定，不是 bug。
- **引用里的多行合并成段落**：不再逐行 `<br />`；引用内的空行（单独一行 `>`）才分段。行末两个空格仍可强制换行（`risc-v_study_1` 的引用就是这么排的）。
- **表格可以紧跟正文出现**：GFM 参考实现通常要求表前有空行，这里故意放宽成"下一行是分隔行就成表"——因为本文档自己的表格就紧贴在列表项正文后面。
- **行内代码用等长反引号**：用两个反引号包住内容时，内容里可以出现单个反引号（旧版只认单反引号，双反引号写法会被拆散）。
- **星号紧贴标点时不算强调**：正文里写 `中文**<u>覆盖</u>**中文` 不会加粗——`**` 后面紧跟标点、前面又既非空白也非标点，按侧翼规则不能开强调；想让 `<u>` 那截加粗，`**` 前面留个空格即可，或直接写 `<strong>`。
- **缩进 4 格 = 代码块**：缩进代码块现在是真代码块（以前当普通段落处理），所以正文里别再靠缩进排版。

**代码块与语法高亮**：

- 结构仍是 `.md-code` 卡片 + `.md-code-bar`（左 `.md-code-lang` 显示信息串原文，右 `.md-code-copy` 复制按钮）；复制取 `<code>` 的 `textContent`，**高亮的 span 不影响复制内容**；成功后按钮短暂变成「已复制！」文字（`1600ms` 后恢复图标），失败则显示红色描边。
- 高亮器认得 `c` / `python` / `asm` / `shell` 四族（别名很宽：`c++`、`h`、`py`、`python3`、`nasm`、`riscv`、`x86_64`、`sh`、`bash`、`zsh`、`console`…）。认得时给 `.md-code` 写 `data-lang="c|python|asm|shell"`、`<code>` 里是 `<span class="tok-*">`；认不得（如 `js`）就整块纯转义，**不高亮但照样能复制**。
- token 词表与变量对照写在 `lib/css/codestyle.css` 的文件头；颜色全走 `--code-*` 变量（`:root` = Light+，`[data-theme="dark"]` = Dark+），规则限定在 `.md-code` 内，不会污染正文其它代码。
- **代码字体统一为 JetBrains Mono**：`lib/fonts/JetBrainsMono[wght].ttf` 是**变量字体**（一个文件覆盖 100~900 字重），由 `generalstyle.css` 的 `@font-face` 登记——文件名带方括号，`url()` 里必须写成 `%5B` / `%5D`，否则会被当成 CSS 语法。围栏代码块、行内代码、代码块标题栏的语言名都走它，回退链保留系统等宽字体；`blog.css` 负责正文里的引用，404 卡片里的代码在 `generalstyle.css` 的 `.nf-card code` / `.nf-card pre` 里引用。
- **加一门新语言三步走**：① 在 `highlight.js` 里写 tokenizer 并 `register('go', { aliases: […], tokenize })`；② 别名写进 `aliases`（大小写自动归一）；③ 需要单独配色就在 `codestyle.css` 里加 `.md-code[data-lang="go"] …`。**渲染器与 `blog.js` 一行都不用动**。

**安全模型（原始 HTML）**：白名单在渲染器里，规则与旧版一致：

- 危险标签（`script` / `iframe` / `form` / `svg` …）**整段丢弃**（连内容）；不在白名单的标签**拆壳**只留文字；`on*` 事件属性一律丢弃；`href` / `src` / `poster` 过协议校验（`javascript:` 之类丢弃）；`style` 里的 `expression(` / `javascript:` 也拦。
- 放行是**逐标签清洗**（字符串层面），不是"塞进 DOM 再序列化"——后者会把未闭合元素补齐，跨行结构（`<details>`）第一行就被补成闭合、后面的正文全掉到折叠块外面。这条是旧版踩过的坑，特意保留了该设计。
- `html: false` 模式：原始 HTML 全部转义成可见文字（404 说明卡片走的就是这条路，见 §4.8）。
- 相对路径仍然**先 `isSafeUrl()` 校验、再 `resolveAssetPath()` 解析**，顺序颠倒会把 `javascript:...` 拼成长相安全的相对路径而漏判。

**跨行 HTML 现在是真块级**：`<div>` … `</div>`、`<details>` … `</details>` 可以分行写，中间空行照样按 Markdown 解析（`life_in_militrain` 的碎碎念就是这么折叠的；`markdown='1'` 这类非白名单属性会被清洗掉，不影响效果）。例：

```
<details><summary>碎碎念</summary>

里面照常写 Markdown

</details>
```

HTML 块按规范分 7 类启动条件：前 5 类（`<script>`/`<pre>`/`<style>`/`<textarea>`、注释、`<?`、`<!X`、CDATA）到结束标记为止，后 2 类（块级标签、独占一行的完整标签）到空行止。

**局限**：不支持脚注；不做智能标点（引号不会自动变全角）；HTML 块内部不再解析 Markdown（块级 HTML 里请自己写标签）；行内 HTML 的危险标签只丢标签本身（`<script>x</script>` 里的 `x` 会作为普通文字留下，但**不会执行**）；表体终止于空行 / 非表格行 / 代码围栏。

**调试**：渲染器在 Node 下也能 `require`（与浏览器共用同一份 `module.exports`），可以直接写夹具脚本对拍 `render()`，不必起浏览器；端到端仍用 jsdom 加载真实 `index.html` 回归（见第八节）。

**文章卡片**：`<a class="blog-item" href="#blog/post/<id>">`（真链接，支持中键/Ctrl+点击新标签页打开），左键点击由 JS 接管并 `pushState`。

**图片/链接路径解析** `resolveAssetPath()`：`http(s)://`、`//`、带协议的（`mailto:`、`data:` 等）、`/` 开头原样保留；相对路径（如 `img/1.jpg`）自动拼成 `lib/documents/blogs/<文章文件夹>/img/1.jpg`，即每篇文章的插图放在自己的文件夹里。

### 4.6 数据维护脚本 `lib/documents/blogs/update_info.bat`

双击运行（无界面）。实际逻辑是一段内联 PowerShell：

1. 遍历 `blogs/` 下的目录（排除 `default` 与历史的 `.Default`）；
2. **只把含 `passage.md` 的文件夹当作文章**（一个文件夹 = 一篇文章）；
3. 读该文件夹 `info/tag.txt` 第 5 行作为 id：若 id 与文件夹名不同则**重命名文件夹**；若目标名已存在或 id 重复则跳过并告警；
4. 把最终 id 列表排序后用 **UTF-8 BOM** 覆写 `list.txt`。

> 关键推论：`list.txt` 里的"id"同时也必须是**文件夹名**——所以 `tag.txt` 第 5 行改了以后必须跑一次这个脚本，否则 `blog.js` 按 `list.txt` 拼路径会 404。

### 4.7 子站点 `othersite/`

- `oldlook/`：旧版主页（内联 `<style>`、`lib/images/backgroud.png` 作背景），主页卡片里有链接入口。
- `testground/`：内容为 `<h1>Hello World!<h1/>` 的空白测试页（新窗口打开）。
- 两者独立、无共享代码，可随时删除而不影响主站（历史上曾删除过 `newlook/`）。

### 4.8 404 页面（`#404`）

**什么时候会看到它**：地址栏 hash 既不是合法标签、也不是合法文章时（`#no-such-page`、`#blog/post/<不存在的 id>`），以及从首页「关于其他页面」卡片点「404 页面」进来时。侧边栏与页脚照常保留——它就是一个普通的 `tab-panel`，只是**没有**侧边栏按钮。

**独立背景**（`#nfBg`，挂在 `<body>` 下，`body.nf-mode` 时显形并盖在壁纸图层之上）：

| 顺序 | 来源 | 说明 |
|---|---|---|
| ① | `lib/images/404page/01.txt` 里的一行 `http(s)` 地址 | `ensureNotFoundBackground()` 先读它，再用 `probeImage()` 预加载验证 |
| ② | `lib/images/404page/01.jpg` | 上一步没有地址 / 加载失败（含 8 秒超时）时退回本地图 |

- 结果记在 `nfBg.dataset.source`（`host` / `local`）并置 `dataset.loaded='1'`，**重复进入 404 不会反复探测**（失败也只会退到本地图，页面不会卡住）。
- 独立背景层不放进 `#tab-404` 内部，是为了避免祖先的 stacking context 把 `z-index: -1` 吃掉。

**巨大的倾斜标题**（`#nfText`）：

- 字体走 `@font-face` 的 `YuFanLiXing`（`lib/fonts/余繁离形体.otf`，`font-display: swap`），缺字时回退系统无衬线；字号 `clamp(2.6rem, 13vw, 11rem)`，窄屏允许换行。
- 样式近未来风：**半透明白**（`rgba(236,246,255,.72)`）+ 双层 `text-shadow`（暗投影 + 青色辉光）。
- **跟随指针倾斜**：舞台 `.nf-stage` 提供 `perspective: 900px`；`pointermove` / `pointerdown` **在整个文档上**监听（不要求指针停在文字上——鼠标在页面任何角落都会触发），按指针相对**整个视口中心**的归一化偏移写入 `rotateY(±22°)` / `rotateX(±12°)`——左右摆幅大、上下做明显的俯仰；指针在右则右缘朝观察者（`rotateY` 取负），指针在下则底缘朝观察者；指针离开窗口 / 窗口失焦时复位。鼠标与手指走同一套 `pointer*` 事件，所以触屏也能玩。幅度常量在 `bindNotFoundTilt()` 的 `MAX_Y`（左右，22）/ `MAX_X`（上下，12）里。
  > 文字设了 `pointer-events: none`：它只是装饰，不能挡住指针移动（否则 `pointermove` 会断断续续）。`prefers-reduced-motion` 下关掉变换过渡。

**说明卡片**（`#nfCard`，在巨大文字与「回到主页」按钮之间）：

- 内容文件：`lib/documents/errorsite/404site/content.md`，由 `window.LongwayMarkdown.render(text, { html: false, sanitize: true })` 渲染后塞进卡片——与正文**同一个渲染器**，只是把 `html` 关成 `false`（原始 HTML 按文字显示）；文件缺失或为空时**整张卡片不出现**。
- **高透明**：背景只 `rgba(255,255,255,.03)`（边框 `rgba(255,255,255,.12)`）+ `backdrop-filter: blur(4px) saturate(120%)`——只做轻微柔化，几乎只剩一层薄描边，背景图基本透得出来；**文字有高光**（两层 `text-shadow`：暗描边压亮背景 + 青色微光提亮），保证压在照片上也读得清。
- 时序：直接访问 `#404` 时 `markdown.js` 可能还没执行完，`ensureNotFoundCard()` 会**等渲染器就绪**（每 100ms 重试，最多约 2 秒，期间不显示），避免把 Markdown 原文（`##`、`**` 之类）露在卡片里；实在等不到才退化为"去掉行首 `#` 标记的纯文本"。

**「回到主页」按钮**：`#nfHomeBtn` → `showTab('home', 'push')`。首页入口是卡片里的 `<a href="#404" id="homeLink404">`（保留真链接，中键/Ctrl 可开新标签），点击时 `preventDefault` 走 `showTab('404','push')`。

**卡片内容的渲染**：卡片不再有"专用渲染器"（旧的 `BlogModule.renderCardMarkdown()` 已删除），改为 `index.html` 直接调 `window.LongwayMarkdown.render(text, { html: false, sanitize: true })`——**块级语法全部可用**（标题就是真 `<h1>`~`<h6>`、列表、表格、代码块），只是原始 HTML 不做放行；相对路径按站点根解析（不传 `folder`，`resolveUrl` 用渲染器默认策略）。卡片内各块的间距与标题辉光由 `generalstyle.css` 的 `.nf-card h1…h6 / p / ul / pre` 控制；404 说明卡片已启用这套写法，主页卡片与历史版本列表以后也能照同一句接。

### 4.9 卡片内 HTML 渲染器（`lib/js/html.js` + `lib/css/html.css`）

**定位**：卡片里要放的不一定是 Markdown（个人介绍、联系方式、小表格、图集更适合直接写 HTML）。这个渲染器负责把"作者写的 HTML 片段"安全地变成 DOM，**不提供任何组件**（头像、标签片、按钮、卡片布局都不管，样式自己写）。

- 加载：`index.html` 里引 `lib/css/html.css` 与 `lib/js/html.js`（脚本最后加载）。
- `autoMount()` 在 `DOMContentLoaded` 后自动扫一遍 `[data-lg-html]`；页面里没有这类元素时**零副作用**。

**API**（`window.LongwayHtml`）：

| 方法 | 作用 |
|---|---|
| `render(html, options)` | 清洗 + 套 `.lg-html` 外壳，返回 HTML 字符串 |
| `sanitize(html, options)` | 只清洗、不套外壳（返回片段） |
| `mount(target, source, options)` | 把内容挂进容器，返回 `Promise<Element>` |
| `autoMount(root, options)` | 扫描 `[data-lg-html]` 批量挂载，返回 `Promise<Element[]>` |
| `escapeHtml(text)` | 转义 `& < > " '` |

`source` 支持四种：HTML 字符串、`{ url }`（先 fetch）、`{ template: '#选择器' }`（从 `<template>` 或 `<script type="text/html">` 取）、`{ element }`（从某个元素的 innerHTML 取）。

**用法（个人介绍卡片）**：

```html
<section class="card">
    <h2>关于我</h2>
    <div data-lg-html data-lg-src="lib/documents/home/intro.html" data-lg-align="left"></div>
</section>
```

`lib/documents/home/intro.html` 里正常写 HTML（标题、段落、列表、表格、`<details>` 都行）。也可以不写属性、手动挂载：

```js
LongwayHtml.mount('#slot', { url: 'lib/documents/home/intro.html' });
```

**autoMount 可用的 data 属性**：`data-lg-src`（文件）、`data-lg-template`（模板选择器）、`data-lg-align="left|center"`、`data-lg-class="额外类名"`、`data-lg-nowrapper`（不套外壳）。都没有时读取元素自身的 innerHTML（等于把手写片段"过一遍"白名单）。

**安全模型**（比文章正文更收窄）：

- 整段丢弃（连内容）：`script` / `style` / `iframe` / `object` / `embed` / `form` 及其控件 / `template` / `svg` / `math` / `canvas` / `base` / `meta` / `link` 等；
- 不在白名单的标签**拆壳留文字**；`on*` 事件属性一律丢弃；`data-*` / `aria-*` 放行；
- `href` / `src` / `poster` / `cite` 过协议校验：`javascript:` / `vbscript:` / `file:` / `blob:` / `about:` / `chrome:` / `jar:` / `view-source:` 丢弃，`data:` 只允许 `data:image/*`；
- `<a target="_blank">` 自动补 `rel="noopener noreferrer"`；`<img>` 缺 `alt` 时补空值，并加 `loading="lazy" decoding="async"`；
- 文本里孤立的 `<` 会转义，避免残缺标签在插入 DOM 后"复活"。

**样式**（`html.css`）：只做基础排版——标题、段落、列表、引用、代码（JetBrains Mono）、表格（自己横向滚动，不撑破卡片）、图片/视频、`<details>`、`<hr>`；颜色走站点变量，亮暗主题自动跟随。对齐默认继承容器（首页 `.card` 居中、阅读区左对齐），需要强制就用 `.lg-html--left` / `.lg-html--center`（或 `data-lg-align`）。

**几个默认值**（都能用 options 改）：`allowInlineStyle` 默认 `true`（会拦 `expression()` / `javascript:`），`allowId` 默认 `false`（避免卡片内容跟页面 id 撞车），`maxLength` 默认 20 万字符。想放宽/收窄放行面，只改 `lib/js/html.js` 的 `ALLOWED_TAGS` / `ALLOWED_ATTRS` / `DROP_TAGS`。它和 `markdown.js` 的清洗器**互不依赖、策略不同**：那边面向文章正文，这边面向卡片。

### 4.10 内容加载的四种方式

站内所有动态内容都走下面四种之一。新增功能时先对号入座，不要另起一套：

| 方式 | 数据文件 | 是否带时间/元信息 | 典型用途 | 入口 |
|---|---|---|---|---|
| **博客 md** | `<文章>/passage.md` + `info/tag.txt`、`info/time.txt`，可选 `cover.png` / `cover.txt` / `img/` | **是**（标题/描述/作者/主题/两个时间） | 博客列表与阅读视图 | `BlogModule.ensureLoaded()` / `openArticle()`；渲染 `window.LongwayMarkdown.render(md, mdOptions(folder))`，相对图片按文章目录解析 |
| **通用 md** | 任意路径的 `content.md` | 否 | 404 说明卡片（`lib/documents/errorsite/404site/content.md`）、版本日志（`RELEASE/<大版本>/<中版本>/content.md`、`BETA/content.md`） | `window.LongwayMarkdown.render(text, { html: false, sanitize: true })`（404）或 `history.js` 的 `mdOptions(dir)`（图片相对 dir 解析） |
| **html** | `.html` 片段 / `<template>` / 内联 `innerHTML` | 否 | 卡片里的富文本（个人介绍等） | `window.LongwayHtml.mount()` / `autoMount()`（元素写 `data-lg-html`），排版在 `lib/css/html.css`（见 §4.9） |
| **txt** | 一行一条的纯文本 | 否 | 文章清单 `blogs/list.txt`、版本清单 `RELEASE/**/list.txt`、致谢名单 | 直接 `fetch` + 按行切分（**未来会被 md/html 取代，新功能不要再用**） |

- **博客 md 与通用 md 的唯一区别**是目录结构与是否带时间信息：前者要有 tag/time 才能进列表、参与「按 `time.txt` 最新编辑时间增量重载」；后者只是一个 md 文件，读进来就渲染，没有作者/时间/封面等概念。
- 四种方式共用同一套 Markdown 渲染器与高亮器，所以代码块（含「已复制！」反馈）、表格、`<details>`、任务列表在四处表现一致。
- 哪种方式都不要在页面里硬编码内容：数据一律放 `lib/documents/` 下，由运行时 `fetch()` 读取——这正是「加文件就上线」的基础。

---

## 五、状态与缓存键一览

| 键 | 存储 | 内容 | 失效 / 清除策略 |
|---|---|---|---|
| `theme` | localStorage | `'light'` / `'dark'`（**只存手动固定的选择**） | 点设置页「跟随浏览器主题」时**删除该键**，回到 `auto` 跟随系统 |
| `sidebarCollapsed` | localStorage | `'1'` 表示收起 | 桌面端手动切换；≤640px 不读取 |
| `LongwaySiteBlogV1` | localStorage | `{ articles: [...], savedAt }`（每篇含 `authors` / `created` / `editTimes` / `latest`） | **逐篇按 `latest`（最新编辑时间）比对**：只有变了的文章重取（连封面）；已删除的文章会被剔除并回写。旧版缓存（没有 `latest`）会被整体判定为过期从而自动迁移 |
| `LongwaySiteHistoryV1` | localStorage | 历史版本清单缓存（RELEASE 的大版本与各中版本、当前选中大版本索引、BETA） | 进入历史页先渲染，再静默重取清单 |
| `LongwaySiteHistoryDocsV1` | localStorage | 版本日志 `content.md` 原文缓存（最多 24 篇） | 打开日志先渲染缓存，再 fetch 比对；超出上限按使用顺序淘汰 |
| `LongwaySiteThanks` | localStorage | 致谢名单行数组 | 同上 |

> 调样式或改数据格式后若看不到变化，先清一次 `localStorage`（缓存优先策略会让旧数据继续显示）。`BlogModule.refresh()`（`window.BlogModule` 上）可强制重取文章数据。
> 文章内容改了却看不到更新时，先检查 `info/time.txt` 的**最后一行（最新编辑时间）**有没有跟着改——缓存就是靠它判断"这篇变了没有"的。

---

## 六、改动入口速查表

| 想做的事 | 改哪里 |
|---|---|
| 发一篇新文章 | 新建 `lib/documents/blogs/<名字>/`：`passage.md` + `info/tag.txt` + `info/cover.png`（可选 `img/`、`info/cover.txt` 外链封面），跑一次 `update_info.bat`。三者都可缺省，会分别落到 `default/` |
| 换封面（用外链图） | 在 `info/cover.txt` 写一行 `http(s)` 地址，并**同时更新 `info/time.txt`**（否则缓存不刷新）。`default/` 不支持该机制 |
| 改文章标题/描述/日期/主题/id | 该文章的 `info/tag.txt`（改 id 后必须跑 `update_info.bat`） |
| 加/删/排序文章 | 直接编辑 `lib/documents/blogs/list.txt`（或让脚本重建） |
| 改全站配色、玻璃感、圆角、字体、间距 | `lib/css/generalstyle.css` 的 `:root` / `[data-theme="dark"]` 变量 |
| 换图标 / 新增"随主题切换"的图标 | 两版文件放进 `lib/icons/`（命名 `<名字>_light.png` / `<名字>_dark.png`），在 `generalstyle.css` 的 `:root` 与 `[data-theme="dark"]` 里成对登记 `--icon-xxx` 变量，组件里写 `background-image: var(--icon-xxx)` |
| 换站点 favicon | `lib/icons/title.ico` + `index.html` 的 `<link rel="icon">` |
| 改主题跟随策略（默认是否跟随系统、开关入口） | `index.html` 的 `<head>` 脚本（`window.AppTheme`）+ 设置页「关于主题」卡片 |
| 允许正文使用更多 HTML 标签 / 恢复 `<iframe>` | `lib/js/markdown.js` 的 `ALLOWED_TAGS` / `DROP_TAGS` 常量 |
| 调整站内导航语义（返回按钮、历史条目） | `index.html` 的 `window.AppNav` + `showTab(name, mode)`；`blog.js` 的 `openArticle(a, mode)` |
| 改全站卡片的最大宽度（宽屏占比） | `lib/css/generalstyle.css` 的 `.container`（当前 `max-width: 75vw`；`≤640px` 另有 `max-width: none`） |
| 改博客两列布局（左列列表、右列筛选） | `lib/css/blog.css` 的 `.blog-layout`（`grid-template-columns: minmax(0,1fr) 220px`）与 `.blog-layout.is-reading`（阅读态默认单列，`≥1024px` 时右列换成停靠的 `.read-nav`）；`header.blog-header` 在 `#blogLayout` 之外、横跨整宽；阅读态开关在 `lib/js/blog.js` 的 `setReadingLayout()` |
| 改博客卡片比例、筛选栏宽度、阅读排版 | `lib/css/blog.css`（卡片 2:8 在 `.blog-item-cover` / `.blog-item-meta`；筛选栏宽度是 `.blog-layout` 的右列宽） |
| 改表格 / 阅读区其他排版样式 | `lib/css/blog.css` 的 `.blog-read-content table`、`.md-table-wrap` |
| 改代码高亮配色 | `lib/css/codestyle.css` 的 `--code-*` 变量（`:root` 浅色 / `[data-theme="dark"]` 深色）；token 对照表在文件头 |
| 新增一门高亮语言 | `lib/js/highlight.js` 写 tokenizer 并 `register(id, { aliases, tokenize })`；需要单独配色再改 `codestyle.css`（详见 §4.5） |
| 改浮动按钮 / 文章导航（出现时机、位置、动画、目录规则） | 时机判定：`blog.js` 的 `updateReadFab()`；目录构建与跳转：`buildReadNav()` / `jumpToHeading()` / `setReadNavOpen()`；外观：`blog.css` 的 `.read-fab` / `.read-nav`；DOM：`index.html` 的 `#readFab`（必须挂在 `<body>` 下） |
| 改阅读态导航的停靠宽度（宽屏常驻右列 / 窄屏回按钮） | 必须成对改两处：`lib/css/blog.css` 的 `@media (min-width: 1024px) .blog-layout.is-reading > .read-nav`，以及 `lib/js/blog.js` 的 `READ_NAV_DOCK_QUERY`（当前同为 `1024px`）；换宿主逻辑在 `placeReadNav()`，判定在 `canDockReadNav()` / `isReadNavDocked()` |
| 改右列卡片（筛选卡 / 停靠导航）的顶线对齐 | 右列卡片与左列内容卡**同一个 grid 行**，靠 `align-items: start` 天然同顶，没有 margin 补偿；想让它们改对齐位置就调 `.blog-layout` 的 `align-items`，或给 `.blog-filter` / `.blog-layout.is-reading > .read-nav` 单独加 `margin-top`（注意筛选卡有 `position: sticky`，滚动吸顶后位置由 `top` 决定） |
| 改筛选维度（如再加"按年份筛"） | `lib/js/blog.js` 的 `getFiltered()`（加过滤分支）+ 同级 `filterXxx` 状态 + `bindFilter()` 绑定输入框 + `renderLoading()` 的筛选守卫 + 重置按钮 |
| 改每页条数 | `lib/js/blog.js` 的 `PER_PAGE`（当前 10） |
| 改并发数（加载速度 vs 请求数） | `lib/js/blog.js` 的 `CONCURRENCY`（当前 4） |
| 支持新的 Markdown 语法 | `lib/js/markdown.js`：行内语法加在 `parseInlines()`（括号栈 / 定界符栈），块级语法加在 `parseBlocks()` 并在 `renderBlock()` 里补渲染（表格就是照这个路子加的：`splitTableRow()` / `isDelimiterRow()` / `renderTable()`） |
| 换壁纸来源 | `index.html` 的 `WALLPAPER_API`（随机入口，当前 `api.yppp.net/api.php`）+ `resolveWallpaperRedirect()`（解析真实链接）+ `#bgLayer` 图层。**换图床前先确认它带 `Access-Control-Allow-Origin`**，否则一键下载会失效 |
| 改「获取当前壁纸」的下载行为 | `index.html` 的 `saveCurrentWallpaper()`（状态提示在 `#bgStatus`）与 `blobToPng()`（保存格式转换） |
| 改历史版本日志 / 增加版本 | 日志正文：`lib/documents/archive/historylist/RELEASE/<大版本>/<中版本>/content.md`；清单不要再手改——双击 `RELEASE/update_list.bat` 按文件夹重建（新的在上）；BETA 只有 `BETA/content.md` 一份 |
| 改历史版本页外观（卡片、大版本号字体、日志视图） | `lib/css/history.css`；逻辑在 `lib/js/history.js`（`BASE` 路径、大版本切换状态、`logPaths()`） |
| 改文章卡片高度上限 / 标题描述行数 | `lib/css/blog.css` 的 `.blog-item`（`min-height:112px` / `max-height:190px`）、`.blog-item-cover`（`aspect-ratio:4/5`、`width: clamp(76px,4.8vw,96px)`、`border:1px solid var(--cyan-500)`）、`.blog-item-title-text`（`-webkit-line-clamp:2`）、`.blog-item-desc`（`-webkit-line-clamp:2`）；手机规则在同文件的 `@media (max-width:820px)` 里（`min-height:84px`、标题 1 行、描述 2 行、封面 `clamp(56px,13vw,72px)`） |
| 改复制按钮的反馈文案 / 时长 | 文案在 `lib/css/blog.css` 的 `.md-code-copy.is-copied::after`（当前「已复制！」），复位时长在 `lib/js/blog.js` 的 `done()` 里（`1600ms`） |
| 改历史版本 / 致谢内容 | 历史版本：见上一行；致谢：`lib/documents/archive/thanks/致谢名单.txt`（纯文本，一行一条） |
| 加一个新标签页 | 四处同步：`index.html` 侧边栏加 `.tab`（`data-tab="x"`）与 `<section id="tab-x">`、把 `#x` 加进 `VALID_TAGS`、在 `renderTab()` 里按需加载数据 |
| 改版本号 / 记录本次更新 | 由站主维护：`README.txt` + `lib/documents/archive/historylist/RELEASE/<大版本>/<中版本>/content.md`（新条目沿用 `RELEASE1.2.x更新内容：…` 写法） |
| 改 404 页（背景、文案、倾斜幅度、字体、说明卡片） | 背景与优先级：`index.html` 的 `ensureNotFoundBackground()` + `lib/images/404page/`；倾斜幅度：`bindNotFoundTilt()` 的 `MAX_Y`（左右）/ `MAX_X`（上下）；说明卡片：`ensureNotFoundCard()` + `lib/documents/errorsite/404site/content.md`；外观与字体：`generalstyle.css` 的 `@font-face` 与 `.nf-*` |
| 让某处卡片改用 .md 内容 | `window.LongwayMarkdown.render(text, { html: false, sanitize: true })`（与正文同一渲染器，块级语法全可用、原始 HTML 转义）；`el.innerHTML = …` 即可（404 说明卡片就是这么用的，卡片外观在 `generalstyle.css` 的 `.nf-card`） |
| 让卡片显示 HTML 片段（个人介绍等） | `window.LongwayHtml`：元素写 `data-lg-html data-lg-src="…"`（或 `data-lg-template`）自动挂载；也可手动 `LongwayHtml.mount('#slot', { url })`。基础排版在 `lib/css/html.css`（详见 §4.9） |
| 改卡片内 HTML 的放行范围 | `lib/js/html.js` 的 `ALLOWED_TAGS` / `ALLOWED_ATTRS` / `DROP_TAGS`（不要动 `markdown.js` 的那套，它服务文章正文） |
| 清掉本地缓存看真实效果 | 浏览器开发者工具 → Application → Local Storage（键名见第五节） |

---


## 七、本地预览提示

项目是纯静态站点，直接双击 `index.html` **不可用**（`file://` 下 `fetch()` 被浏览器 CORS 策略拦截，博客/历史版本/致谢全部加载失败，背景刷新也可能受限）。本地调试请用任意静态服务器，例如在仓库根目录执行：

```powershell
python -m http.server 8000      # 或 npx serve .
```

然后访问 `http://localhost:8000/`。发布侧无需任何构建步骤，`git push` 到 `main` 即由 GitHub Pages 自动上线。

**实测提示**：这台机器上的 `python` 只是 Microsoft Store 的占位程序，`python -m http.server` 会报 "Python was not found"。可改用 Node（已装 v24）随手起一个静态服务器：

```js
node -e "const h=require('http'),f=require('fs'),p=require('path');h.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';f.readFile(p.join(process.cwd(),u),(e,d)=>{e?(s.writeHead(404),s.end('404')):(s.writeHead(200,{'Cache-Control':'no-store'}),s.end(d))})}).listen(8000,()=>console.log('http://127.0.0.1:8000'))"
```

- 另外 `npm` 的默认缓存目录也可能被沙箱拒绝写入，需要时加 `--cache ./.npm-cache` 指到仓库内。
- 注意：连续的 `>` 行会合并成一个引用；引用里的代码块（`> ```C` 这种）也能正常渲染（整段引用会递归走一遍块级渲染）。

---

## 八、本次改动的验证方式（可复用）

改动最终用 **jsdom 端到端回归**验证：装一个临时 `jsdom`（`npm i jsdom --prefix .tmp-test --cache .tmp-test/npm-cache`，注意 npm 默认缓存目录可能被沙箱拒绝，需用 `--cache` 指到仓库内），用 `JSDOM.fromURL` 加载**真实的** `index.html`（`runScripts: 'dangerously'` + `resources: 'usable'`），并在 `beforeParse` 里补两样 jsdom 缺失的东西：

- `window.fetch`（转发到 Node 的 `globalThis.fetch`）；
- `window.matchMedia`（可注入"系统是否为深色"）。

再准备临时的"夹具"文章——`_sectest/`（载荷夹具：`<img onerror>`、`<svg onload>`、`<script>`、`javascript:` 链接、实体编码变体、`<iframe>`、未知标签、跨行元素等）与 `_tabletest/`（表格边界夹具：对齐、代码里的竖线、`\|` 转义、单列、缺列/多列、紧邻列表、文件结尾无空行、代码块内的表格）——把它们临时加进 `list.txt`，跑完**逐字节还原** `list.txt` 并删除夹具。

覆盖的断言分六组：

1. **HTML 白名单过滤**：脚本未执行、`on*` 全清、危险标签整段丢弃、`javascript:`（含大小写混淆与实体编码）被剥离、白名单标签与 `<style>`/`<pre>` 保留、未知标签拆壳留文字、HTML 行内 Markdown 生效、相对路径图片解析正确。
2. **站内导航**：点标签产生历史、点卡片进阅读视图、浏览器后退回到列表、前进重新进入文章；「返回」按钮走真回退；直达链接（无站内历史）点「返回」回列表且 hash 不被改写。
3. **主题三态**：打开时按系统渲染、默认 `auto`、点击固定为另一色并写入 `localStorage`、点「跟随浏览器主题」回到 `auto` 并清除存储、刷新后仍跟随。
4. **表格渲染**：真实文章渲染出的表格数量与**源码独立数出来的数量**一致；对齐三态、代码块内的竖线与 `\|` 转义不切分单元格、单列表格、缺列补空与多列裁剪、紧邻列表的表格、文件结尾无空行也能解析、代码块内的表格不解析、普通段落里的竖线仍是段落。
5. **新契约 / 缓存 / 渲染支持**：作者与时间解析、列表卡片显示第一位作者与最新编辑时间、阅读视图右侧作者分组与悬停记录、按最新编辑时间排序；**缓存命中时一篇正文都不重取**（用注入的假缓存 + 请求计数验证）、**单篇更新时只重载该篇并给它换上新封面版本号**、旧版缓存自动迁移；选项框数量与源码一致且不可交互、折叠块内容确实落在 `<details>` 内部、`markdown='1'` 被清洗。
6. **筛选与浮动按钮**：作者搜索的部分匹配/大小写不敏感/多作者/与其他筛选取交集/重置清空；点作者名直接筛选（列表卡片与阅读视图两处，且不会误开文章）；右下角浮动按钮的显示时机与「返回 / 回到顶部」。另有 **壁纸**一组：随机入口 → 真实固定链接的解析、下载必须命中固定链接而非随机入口、保存格式转 PNG 及失败回退。

> 写断言的小技巧：**别硬编码"应该有 5 行"这类数字**——第一版测试就是这么写出 4 个"失败"的，核对源码后发现全是预期写错（表格其实 4 行数据、夹具其实 6 张表）。改成"用独立实现从源码数一遍，再和 DOM 对照"之后，测试才真正在验证代码。同理，缓存测试要**先确认自己写对了缓存键**——第一版用旧键名 `longwebBlogV1` 播种，结果全是假失败。

> 验证环境说明：本机沙箱禁止启动 Edge/Chrome 无头浏览器（`Access is denied`），因此用 jsdom 代替真实浏览器；jsdom 覆盖 DOM/JS 行为，但**不覆盖真实排版与视觉**，涉及 CSS 的改动（例如文章卡片由 `<article>` 变 `<a>`、主题胶囊让位留白）建议在浏览器里再肉眼确认一次。

---

## 附录 A：新增一篇文章的完整步骤（最常用操作）

1. **建文件夹**：在 `lib/documents/blogs/` 下新建一个目录，名字随意（建议英文/数字，如 `my_post_1`）。它既是路径名，最终也会被脚本改名为文章 id。
2. **写正文**：在该目录下新建 `passage.md`（UTF-8 **无 BOM**）。语法见 §4.5；插图放进 `img/` 子目录，用相对路径引用：`![说明](img/1.jpg)`。
3. **写元数据**：新建 `info/tag.txt`（UTF-8 **无 BOM**），**严格 5 行**：

   ```
   文章标题
   一句话描述（列表摘要，最多显示 2 行）
   作者名
   #主题名
   my_post_1
   ```

   - 第 3 行是**作者**（多位作者用空格分隔，如 `张三 李四`）；列表卡片只显示第一位，阅读视图显示全部；
   - 第 4 行的 `#` 会被自动去掉，值用于主题胶囊与"按主题精确筛选"；
   - 第 5 行是**文章 id**，会同时成为文件夹名与 `#blog/post/<id>` 里的 id，**必须与文件夹名一致**（由第 6 步的脚本负责改名保证）。
4. **写时间**：新建 `info/time.txt`（UTF-8 **无 BOM**），格式为紧凑的 `YYYYMMDD`：

   ```
   20260926
   (空行)
   20260928
   ```

   - 第 1 行撰写时间，第 2 行固定空白，第 3 行起是修改时间（升序，可省），**最后一行即最新编辑时间**；
   - 没有任何修改时只写第 1 行即可（此时最新编辑时间 = 撰写时间）；
   - **改完文章一定要更新这里的最后一行**，否则浏览器缓存不会知道这篇变了。
5. **放封面**：可选，`info/cover.png`。**推荐比例 4:5（0.8，略竖）**，例如 **320×400 px** 刚好够（宽屏封面框最大约 92×115 px，2 倍屏 ≈184×230；想留余量可给 400×500 或 800×1000）；缺省时列表卡片会自动降级到 `default/info/cover.png`。也可以用 `info/cover.txt` 写一行外链地址来替代（见「封面外链」一节）。详见下面的「卡片高度与封面」。
6. **跑脚本**：双击 `lib/documents/blogs/update_info.bat`。它会按 `tag.txt` 第 5 行重命名文件夹（若与 id 不一致）并重建 `list.txt`（UTF-8 BOM、按 id 排序）。看到 `list.txt updated with N ID(s).` 即为成功。
7. **本地确认**：起个静态服务器（见第七节）打开 `#blog`，确认新卡片出现（标题 + 第一位作者 + 最新编辑时间）、封面/描述正常、点进去正文渲染正确、作者与最新编辑时间在元信息行最右侧。
8. **提交**：`git add` → `git commit` → `git push`；GitHub Pages 会自动发布，**无需任何构建**。版本号与更新记录由站主维护：写进 `lib/documents/archive/historylist/RELEASE/<大版本>/<中版本>/content.md`（沿用 `RELEASE1.2.x更新内容：…` 写法）与 `README.txt` 的版本号。

**卡片高度与封面（自适应高度 + 固定 4:5 封面）**

列表卡片是 grid 两列：`.blog-item` 宽 = 浏览区 90%，`grid-template-columns: auto minmax(0, 1fr)`，`gap: 0.8rem; padding: 0.5rem`，左封面 `.blog-item-cover`、右元数据 `.blog-item-meta`。**封面是固定 4:5 的圆角矩形**（`aspect-ratio: 4/5; border-radius: 10px`），宽度用 `clamp(76px, 4.8vw, 96px)` 跟着屏幕走，高度由比例反推（宽度 × 1.25），所以卡片越大封面越大；外框带一条 `1px solid var(--cyan-500)` 的主题色细边；图片用绝对定位的 `object-fit: cover` 填满这个框（居中裁切）。

**卡片高度由右侧文字决定**：`.blog-item` 有 `min-height: 112px`（桌面下限）与 `max-height: 190px`；标题最多 2 行、描述最多 2 行（`-webkit-line-clamp`，超出省略），文字多了卡片自然长高、到 190px 封顶，文字少的卡片停在 112px。所以大屏上一屏能放下的文章更多，也不会出现又高又空的卡片（实测宽屏卡片 113–133px、封面 76–92px 宽）。

- 手机（≤820px）：`min-height: 84px`，标题强制 1 行省略号、描述 2 行；封面宽度改 `clamp(56px, 13vw, 72px)`，即约 56–72px 宽、70–90px 高。
- **封面宽度别写成百分比**：封面在 `auto` 宽的 grid 轨道里，百分比没有确定基准，浏览器会直接掉到 `clamp()` 下限（实测写 12% 时任何宽度都只有 88px）。用 `vw` 才能跟着屏幕/卡片一起长。也别把卡片改回 flex——flex 子项被 `stretch` 拉伸的高度不算 definite，`aspect-ratio` 会把封面宽度算成 0。
- 卡片的宽高都可以随手量：`#blogCardList .blog-item`、`.blog-item-cover`、`.blog-item-cover img`。

**封面怎么准备**

| 场景 | 卡片宽 | 卡片高 | 封面框（宽 × 高） |
|---|---|---|---|
| 宽屏桌面（1280–1920px；容器 `75vw`，右列 220px） | ≈616–1046 px | 113–133 px | ≈76–92 × 95–115 px |
| 桌面（1081–1279px） | ≈400–616 px | 113 px | 76 × 95 px |
| 窄桌面 / 平板（641–1080px；≤820 筛选卡落到下方） | ≈404–510 px | 113 px（≤820 为 106 px 左右） | 76 × 95 px（≤820 为 72 × 90 px） |
| 手机（≤640px） | ≈220–508 px | 84–97 px | 56–72 × 70–90 px |

- **结论：源图仍用 4:5（竖版，如 320×400 或 400×500）最划算**：封面框比例恒为 0.8，任何断点都不会被裁掉两侧，只有居中裁切带来的上下小幅差异。
- 因为 `object-fit: cover` 是**居中裁切**，新增封面请把主体放在画面中央；站内现有封面基本都是 4:5（703×878 / 720×900 / 793×991 / 899×1124）。
- 尺寸与体积：封面框最大约 92×115 px，源图给 **320×400 已够 2 倍屏**，400×500 更稳；现有 `cover.png` 多在 200–330 KB，可顺手压缩（PNG 转 8-bit 调色板或用 WebP 都能瘦身）。
- 屏幕比 1920px 还宽时封面停在 96px 宽（`clamp` 上限），卡片变宽但封面不再放大，不必再按像素调封面。

**常见坑**

- `tag.txt` 第 5 行改了却没跑脚本 → `blog.js` 按 `list.txt` 里的旧名字拼路径 → 封面与正文双双 404（正文会落到 `default/passage.md` 的"内容缺失"提示）。
- `tag.txt` 少写一行 → 后面的字段会**整体上移**（第 3 行的主题被当成作者等），因此缺行要留空行占位，不要直接省略。
- **`tag.txt` 必须凑满 5 行**（`update_info.bat` 的判断是 `$lines.Count -ge 5`）：只有前 4 行时脚本不会改名（保持文件夹名），但 `blog.js` 会用文件夹名生成 `post_xxx` 作为文章 id，导致它与 `list.txt` 里的条目**对不上**——后果是缓存比对恒判定"有新文章"，**每次打开博客都会全量重取正文**（功能正常，只是白费流量）。
- **改完文章忘了更新 `info/time.txt` 的最后一行** → 缓存认为这篇没变，读者看到的仍是旧内容。这是"更新后不刷新"的头号原因。**换封面外链（`cover.txt`）同理**：它只在文章重载时才被读取，不更新 `time.txt` 就换不掉封面。
- **`cover.txt` 里写了外链却仍显示 `cover.png`** → 先确认链接是**带协议的绝对地址**（`www.` 开头会被判为格式错误而回落），再看图床是否允许跨域/防盗链（那是图片本身加载失败，卡片会逐级降级到 `cover.png`）。
- **同一天里改了两次、日期却没变**（`YYYYMMDD` 精度只到天）→ 上面的判断同样认为"没变"。目前**没有**绕过办法，因为契约里判新旧只看这个日期；实在要让已缓存的读者看到新版，只能：让读者清一次站点数据，或作者在控制台执行 `window.BlogModule.refresh()` 强制重取。
- `time.txt` 必须是 `YYYYMMDD`（8 位数字）。写成 `2026年9月28日` 会被判为非法时间：排序时按 0 处理（排到最前），并且每次打开都会因 `latest` 对不上而重取这篇。
- 更新后 `list.txt` 会被脚本重写为**按 id 排序**，手工维护的顺序会被覆盖。

---

## 附录 B：一句话总览（给未来的自己）

> 这是一个"用 git 当后台、用 txt/md 当数据库"的静态站：`index.html` 管外壳与主题，`lib/js/blog.js` 管博客（缓存优先 + 有界并发加载），正文交给 `lib/js/markdown.js`（CommonMark + GFM + HTML 白名单）与 `lib/js/highlight.js`（代码高亮），`lib/documents/` 里全是内容。改样式去 CSS 变量，改内容加文件夹，改行为看 `blog.js`，发布只需 `git push`。
