# LongwaySite项目结构分析

| 项 | 值 |
|---|---|
| 最后更新 | 2026-09-28 |
| 仓库 | https://github.com/LongwayStar/longwaystar.github.io |
| 部署 | GitHub Pages，`main` 分支根目录，域名 `longwaystar.github.io` |
| 代码规模 | `index.html` 668 行 · `lib/js/blog.js` 1489 行 · 两份 CSS 共 1612 行 |

**本文覆盖面**：目录结构 → 页面架构与路由 → 七个功能模块的实现方式 → 状态与缓存键 → 改动入口速查表 → 本地预览 → 验证方法 → 新增文章的完整步骤。

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
├─ README.txt                  ← 简介与当前版本号（已同步至 REALEASE1.1.4）
├─ lib/                        ← 资源库
│  ├─ css/
│  │  ├─ generalstyle.css      ← 全局主题变量、布局、侧边栏、卡片、页脚、响应式
│  │  └─ blog.css              ← 博客模块专属样式（列表/卡片/筛选/分页/阅读视图）
│  ├─ js/
│  │  └─ blog.js               ← 博客模块全部逻辑（约 1490 行，含自研 Markdown 渲染器 + HTML 白名单清洗器）
│  ├─ icons/                   ← 图标：成对提供 light / dark 两版，按主题自动切换
│  │  ├─ title.ico             ← 站点 favicon
│  │  ├─ lablesbar_light.png / lablesbar_dark.png   ← 侧边栏汉堡图标
│  │  ├─ back_light.png / back_dark.png             ← 阅读视图返回箭头
│  │  └─ totop_light.png / totop_dark.png           ← 回到顶部（用于阅读视图右下角浮动按钮）
│  ├─ images/ fonts/           ← 预留空目录（仅 readme.txt 占位，当前未使用）
│  └─ words/                   ← 全部"内容数据"
│     ├─ blogs/                ← 博客数据区
│     │  ├─ list.txt           ← 文章清单（每行一个文章文件夹名/id）
│     │  ├─ update_info.bat    ← 数据维护脚本：按 tag.txt 重命名文件夹并重建 list.txt
│     │  ├─ default/           ← 兜底数据（缺 tag.txt / passage.md / cover.png 时逐项降级使用）
│     │  ├─ site_info_1/       ← 文章：本站的起源
│     │  │  ├─ passage.md      ← 正文（Markdown 子集）
│     │  │  ├─ info/tag.txt    ← 元数据（5 行）
│     │  │  ├─ info/cover.png  ← 列表封面图
│     │  │  └─ img/1..5.jpg    ← 正文插图（相对路径引用）
│     │  └─ test_1/            ← 文章：测试文章（最小样例）
│     ├─ historylist/          ← RELEASE版本.txt / BETA版本.txt（历史版本面板数据）
│     └─ thanks/致谢名单.txt    ← 设置页致谢列表数据
└─ othersite/                  ← 独立子站点（与主站无耦合）
   ├─ oldlook/                 ← 旧版主页（保留展示用，已停止维护）
   └─ testground/              ← 空白测试页（Hello World）
```

> 验证方式见第八节，新增文章步骤见附录 A。

---

## 三、页面架构与路由

### 3.1 单页 + 侧边栏标签

`index.html` 是唯一页面，内部用「一个侧边栏 + 五个面板」的结构：

| 标签 | 面板 id | 触发时加载的数据 |
|---|---|---|
| 主页 | `#tab-home` | 无（静态卡片：GitHub / B站 / 其他页面） |
| 我的博客 | `#tab-blog` | `BlogModule.ensureLoaded()`（懒加载） |
| 空白页面 | `#tab-empty` | 无（预留） |
| 历史版本 | `#tab-history` | `loadHistory()` → 2 个 txt（懒加载 + 缓存） |
| 设置与相关 | `#tab-settings` | `loadThanks()` → 致谢名单 txt（懒加载 + 缓存） |

切换逻辑集中在 `index.html` 的 `renderTab(name)`（只切 DOM 与按需加载，**不写 URL**）与 `showTab(name, mode)`（负责历史记录语义）。`showTab` 通过 `window.AppShowTab` 暴露给 `blog.js` 复用，避免重复绑定。

### 3.2 hash 路由与浏览器历史

- 标签级：`#home` / `#blog` / `#empty` / `#history` / `#settings`
- 文章级：`#blog/post/<文章 id>`（收藏夹可直达、可分享）

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

- 来源：第三方 API `https://t.alcy.cc/ycy`（`WALLPAPER_API`）——这是一个**随机壁纸入口**：每次请求都会跳到另一张图，所以**它本身不能当壁纸地址**。
- **核心：先解析真实固定链接**（`resolveWallpaperRedirect()`）：用 `fetch(..., { method: 'HEAD', redirect: 'follow' })` 跟随重定向，从 `response.url` 拿到**重定向后的真实固定链接**；HEAD 不被支持时退回 GET，并在读到地址后立即 `AbortController.abort()` 中断（不把整张图下下来）。
  > ⚠️ 曾经的坑：早先版本读的是 `img.currentSrc`，以为那是重定向后的地址——**其实 `currentSrc` 只是"当前选中的源"，没写 `srcset` 时就等于你设进去的原始 URL**。于是背景渲染、下载各请求一次随机入口，拿到的是两张不同的图，这正是"获取当前壁纸拿到的和屏幕上的不一样"的根因。
- 刷新流程（`refreshBackground()`，侧边栏与设置页两个「刷新背景」按钮都调它）分三级降级：
  1. **解析到真实链接** → 预加载后设为背景（`currentBg.url`，`resolved = true`）；
  2. **没重定向 / 解析不到** → 直接 `fetch` 成 blob，用 `URL.createObjectURL()` 产生稳定的同源地址当背景（同样是屏幕上那张图，且已经把数据握在手里）；
  3. **连 CORS 都没有** → 退回旧办法（`new Image()` 预加载 + 随机入口当背景），`resolved = false`：图能显示，但地址不稳定。
- **获取当前壁纸**（「关于背景」卡片的按钮，`saveCurrentWallpaper()`）：把屏幕上正在显示的那张图存成文件，文件名形如 `wallpaper-2026-09-28-153012.png`。
  - 已经是 blob 的直接落盘；否则按**真实固定链接** `fetch` 成 blob，再用同源 blob URL + `<a download>` 触发下载（跨域 URL 直接挂 `download` 会被浏览器忽略，转成 blob URL 才一定生效）；
  - **保存格式统一为真正的 PNG**（`blobToPng()`）：源图不是 PNG 时用 canvas 重编码（`drawImage` + `toBlob('image/png')`）——注意**只改后缀不算转格式**，JPEG 的字节不会因此变成 PNG。代价是 PNG 无损、体积通常是原 JPEG 的 3~10 倍；
  - 源图本来就是 PNG 则直接复用，不做多余重编码；`canvas` 不可用或图片超大导致转换失败时，**回退为按原格式保存并在状态行说明**（宁可保持原样，也不给一个名不副实的文件）；
  - 若某一步读不到字节（图床不给 CORS）→ 退化为在新标签页打开那个**固定链接**，提示右键「图片另存为」；
  - 若连真实链接都没解析出来（第 3 级降级状态）→ **明确提示拿不到与屏幕一致的原图**，而不是塞给用户一张错图；
  - 各种结果都会写在卡片的状态行（`#bgStatus`，`.card-status`，为空时 `:empty` 自动不占高度）。
- CSS 中的 `body { background-image: url('https://t.alcy.cc/ycy') }` 只是首屏默认值，JS 加载后会覆盖成解析出来的固定链接。

### 4.4 历史版本 / 致谢名单

两个功能共用同一套「**缓存优先 + 静默更新**」模式：

1. 用 `readListCache(key)` 读 `localStorage` 并立即渲染（无网络等待）；
2. `fetch(url, { cache: 'no-store' })` 拉最新文本，按行切分过滤空行；
3. 成功则写缓存 + 重渲染；失败时若**无缓存**才报错，有缓存则保留旧内容。

- 用 `historyLoaded` / `thanksLoaded` 布尔标志保证只加载一次（懒加载 + 幂等）。
- **编码约定（实测确认）**：`list.txt` 带 UTF-8 BOM（由 `update_info.bat` 写出，`blog.js` 用 `trim()` 顺带吃掉 BOM）；`tag.txt`、`passage.md`、`historylist/*.txt`、`致谢名单.txt` **都不带 BOM**。手工编辑这些文件时请保持 UTF-8 无 BOM，否则 `tag.txt` 第 1 行的标题会带上不可见字符。

### 4.5 博客模块 `lib/js/blog.js`（项目核心）

#### 数据契约

`lib/words/blogs/list.txt`：每行一个文章文件夹名（空行忽略；`default` 与历史遗留名 `.Default` 均被过滤）。

每篇文章文件夹：

```
<文章文件夹>/
├─ passage.md          正文（可选；缺失时取 default/ 兜底）
└─ info/
   ├─ tag.txt          元数据，5 行（缺失行逐行用 default/ 兜底）
   ├─ time.txt         时间数据（缺失时整体用 default/ 的时间）
   └─ cover.png        列表封面（可选；缺失时由卡片 <img onerror> 降级到 default 封面）
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
  > **修改时间只在确实存在修改记录时才出现**：`time.txt` 只有一行（没有修改行）时，这项整块不渲染（`editTimes.length === 0` 就跳过）。
- **修改时间上的浮动提示框**：鼠标移入（或键盘聚焦 / 触屏点击）弹出 `.edit-tip` 玻璃小卡片，列出**最近五条编辑记录**（不足五条则全部显示；`editTimes` 升序取末尾 5 条再倒序 → 最新在最上）。由 `buildEditTip()` 构建、`closeEditTips()` 统一收起（点别处或离开文章时），显隐用 opacity + transform + visibility 过渡，风格与右下角浮动按钮一致；触屏下点击触发元素开合（`stopPropagation`，免得被全局收起逻辑立刻关掉）。
- `closeArticle()`：反向操作，标题恢复 `LongwaySite`，hash **替换**回 `#blog`，并清空 `pendingPostId`（用户主动返回即放弃直达目标）。
- 直达两种路径：缓存命中 → 立即阅读（无进度条）；未命中 → `enterReadingPlaceholder(id)` 先显示骨架 + 不确定态进度条，加载完成后填充。
- **右下角浮动按钮**（`#readFab`，DOM 挂在 `<body>` 下）：竖排两枚 —— 上「返回」(`#fabBack`)、下「回到顶部」(`#fabTop`)。二者共用 `handleBackAction()` 与 `backToTop()`；显示时机由 `updateReadFab()` 判定，需**同时**满足"阅读容器可见 **且** 博客标签是激活状态"与"文章标题已滚出视口上方（`#blogReadTitle` 的 `getBoundingClientRect().bottom < 0`）"，滚动/尺寸变化时用 `requestAnimationFrame` 合并更新，显隐靠 `.read-fab.visible` 的 opacity + transform + visibility 过渡。
  > 为什么按钮不放在 `.blog-browse` 里：该容器带 `backdrop-filter`，会让 `position: fixed` 的包含块退化成它本身，按钮就不再相对视口固定了——所以浮动按钮必须挂在 `<body>` 下。同理，`.blog-back` 与浮动按钮的图标都改用 `background-color` + `background-image`，避免 `background` 简写把图标重置掉。

#### 自研 Markdown 渲染器（`parseInline` 行内解析 / `renderMarkdown` 块级渲染）

支持：`#`~`######` 标题、`>` 引用、`-`/`*` 无序列表、`1.` 有序列表、**选项框（任务列表）**、`---` 分割线、**GFM 表格**、围栏代码块（含语言 → `class="language-x"`）、行内代码 `code`、`~~删除线~~`、`**粗体**`、`*斜体*`/`_斜体_`、`![alt](src)` 图片、`[text](href)` 链接、**折叠文字**（原始 HTML 的 `<details>/<summary>`）。
  > 注意：行内代码只认**单个反引号**，Markdown 里用双反引号包裹代码的写法（用来在代码里再套反引号）**不被支持**，会被拆得七零八落——正文里请避开这种写法。

- **嵌套支持**：`parseInline()` 不断找"最早出现的标记"递归解析，所以 `~~_斜体_~~` 可正常嵌套。
- **选项框（任务列表）**：`- [ ] 未完成` / `- [x] 已完成`，也支持 `*` 作项目符号。渲染成 `<input type="checkbox" disabled>`（**只作展示，不可交互**，因此不会进键盘焦点、也不会被误点），已勾选的项文字加删除线并变灰。样式见 `blog.css` 的 `.md-task`。
- **折叠文字**：正文里直接写原始 HTML（本站 `life_in_militrain` 就是这么用的）：
  ```
  <details markdown='1'><summary>碎碎念</summary>

  里面照常写 Markdown

  </details>
  ```
  `<details>` / `<summary>` 本来就在 HTML 白名单里，所以**开合标签逐行放行、中间的内容照常按 Markdown 解析**；`markdown='1'` 这类非白名单属性会在清洗时被丢掉（不影响效果）。展开/收起的箭头与容器样式见 `blog.css` 的 `.blog-read-content details`。
- **表格（GFM 风格）**：表头行 + 分隔行即可成表，列数由表头决定。
  | 写法 | 效果 |
  |---|---|
  | `| a | b |` 后跟 `|---|---|` | 两列表格，默认左对齐 |
  | `|:---|:---:|---:|` | 依次为左对齐 / 居中 / 右对齐（写成内联 `style`） |
  | 表体少于表头列数 | 缺的单元格补空 |
  | 表体多于表头列数 | 多出的单元格被裁掉 |
  | 单元格内含 `a | b`（反引号包裹） | 反引号里的竖线**不切分**单元格 |
  | 单元格内含 `\|` | 转义竖线，显示为字面 `|` |
  - 表格在**围栏代码块内不解析**；空行 / 非表格行 / 代码围栏会终止表体；文件结尾无空行的表格也能正常解析。
  - 表头前的缩进（如写在列表项下的表格）会被忽略，表格会渲染成完整宽度（**不会嵌进 `<li>` 里**）——这是与标准 GFM 的一点差异。
  - 样式在 `lib/css/blog.css`（`.blog-read-content table` / `.md-table-wrap`），外层容器负责窄屏横向滚动。
- **安全模型**：先 `escapeHtml()` 再解析 → 普通文本里的 HTML 被转义；**整行形如 `<...>` 的行会走白名单清洗后放行**（`sanitizeHtmlLine()`，必要时退回 `sanitizeHtml()`，都定义在 `blog.js` 的「原始 HTML 行安全过滤」一段）——危险标签整段丢弃、未知标签拆壳、`on*` 与未知属性移除、URL 协议校验。正文作者虽然能写 HTML，但已无法执行脚本。
- **文章卡片**：`<a class="blog-item" href="#blog/post/<id>">`（真链接，支持中键/Ctrl+点击新标签页打开），左键点击由 JS 接管并 `pushState`。
- **图片/链接路径解析** `resolveAssetPath()`：`http(s)://`、`//`、`data:`、`/` 开头原样保留；相对路径（如 `img/1.jpg`）自动拼成 `lib/words/blogs/<文章文件夹>/img/1.jpg`，即每篇文章的插图放在自己的文件夹里。
  > 顺序陷阱：**任何 URL 都必须先 `isSafeUrl()` 校验、再 `resolveAssetPath()` 解析**。反过来会把 `javascript:...` 拼成 `lib/words/blogs/<文章>/javascript:...` 这种长相安全、从而漏判的相对路径（修清洗器时踩过，已被回归测试抓出）。
- 局限：**Markdown 语法本身**不支持脚注、段落内换行合并（空行会产生空 `<p></p>`）、引用/列表的多层嵌套；脚注等复杂排版需写成原始 HTML 行（走白名单放行）。
- **已知未覆盖**：跨行 HTML **结构**仍不是真正的块级 HTML——`<div>` 与 `</div>` 分行写会被 `<p>` 打断；只有 `<details>…</details>` 因为开闭标签各自成行、且中间内容照常解析，才能正常折叠（多行 `<table>` 等结构请写在一行里）。另外普通文本行里的行内 `<b>` 会被转义成可见文本——这是"行内 HTML 不开放"的设计，不是缺陷。

### 4.6 数据维护脚本 `lib/words/blogs/update_info.bat`

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

---

## 五、状态与缓存键一览

| 键 | 存储 | 内容 | 失效 / 清除策略 |
|---|---|---|---|
| `theme` | localStorage | `'light'` / `'dark'`（**只存手动固定的选择**） | 点设置页「跟随浏览器主题」时**删除该键**，回到 `auto` 跟随系统 |
| `sidebarCollapsed` | localStorage | `'1'` 表示收起 | 桌面端手动切换；≤640px 不读取 |
| `LongwaySiteBlogV1` | localStorage | `{ articles: [...], savedAt }`（每篇含 `authors` / `created` / `editTimes` / `latest`） | **逐篇按 `latest`（最新编辑时间）比对**：只有变了的文章重取（连封面）；已删除的文章会被剔除并回写。旧版缓存（没有 `latest`）会被整体判定为过期从而自动迁移 |
| `LongwaySiteHistoryRelease` | localStorage | RELEASE 版本行数组 | 每次进入面板静默刷新 |
| `LongwaySiteHistoryBeta` | localStorage | BETA 版本行数组 | 同上 |
| `LongwaySiteThanks` | localStorage | 致谢名单行数组 | 同上 |

> 调样式或改数据格式后若看不到变化，先清一次 `localStorage`（缓存优先策略会让旧数据继续显示）。`BlogModule.refresh()`（`window.BlogModule` 上）可强制重取文章数据。
> 文章内容改了却看不到更新时，先检查 `info/time.txt` 的**最后一行（最新编辑时间）**有没有跟着改——缓存就是靠它判断"这篇变了没有"的。

---

## 六、改动入口速查表

| 想做的事 | 改哪里 |
|---|---|
| 发一篇新文章 | 新建 `lib/words/blogs/<名字>/`：`passage.md` + `info/tag.txt` + `info/cover.png`（可选 `img/`），跑一次 `update_info.bat`。三者都可缺省，会分别落到 `default/` |
| 改文章标题/描述/日期/主题/id | 该文章的 `info/tag.txt`（改 id 后必须跑 `update_info.bat`） |
| 加/删/排序文章 | 直接编辑 `lib/words/blogs/list.txt`（或让脚本重建） |
| 改全站配色、玻璃感、圆角、字体、间距 | `lib/css/generalstyle.css` 的 `:root` / `[data-theme="dark"]` 变量 |
| 换图标 / 新增"随主题切换"的图标 | 两版文件放进 `lib/icons/`（命名 `<名字>_light.png` / `<名字>_dark.png`），在 `generalstyle.css` 的 `:root` 与 `[data-theme="dark"]` 里成对登记 `--icon-xxx` 变量，组件里写 `background-image: var(--icon-xxx)` |
| 换站点 favicon | `lib/icons/title.ico` + `index.html` 的 `<link rel="icon">` |
| 改主题跟随策略（默认是否跟随系统、开关入口） | `index.html` 的 `<head>` 脚本（`window.AppTheme`）+ 设置页「关于主题」卡片 |
| 允许正文使用更多 HTML 标签 / 恢复 `<iframe>` | `lib/js/blog.js` 的 `HTML_ALLOWED_TAGS` / `HTML_DROP_TAGS` 常量 |
| 调整站内导航语义（返回按钮、历史条目） | `index.html` 的 `window.AppNav` + `showTab(name, mode)`；`blog.js` 的 `openArticle(a, mode)` |
| 改博客卡片比例、筛选栏宽度、阅读排版 | `lib/css/blog.css`（卡片 2:8 在 `.blog-item-cover` / `.blog-item-meta`） |
| 改表格 / 阅读区其他排版样式 | `lib/css/blog.css` 的 `.blog-read-content table`、`.md-table-wrap` |
| 改右下角浮动按钮（出现时机 / 位置 / 动画） | 时机与判定：`lib/js/blog.js` 的 `updateReadFab()`；外观与动画：`lib/css/blog.css` 的 `.read-fab` / `.read-fab.visible`；DOM：`index.html` 的 `#readFab`（必须挂在 `<body>` 下） |
| 改筛选维度（如再加"按年份筛"） | `lib/js/blog.js` 的 `getFiltered()`（加过滤分支）+ 同级 `filterXxx` 状态 + `bindFilter()` 绑定输入框 + `renderLoading()` 的筛选守卫 + 重置按钮 |
| 改每页条数 | `lib/js/blog.js` 的 `PER_PAGE`（当前 10） |
| 改并发数（加载速度 vs 请求数） | `lib/js/blog.js` 的 `CONCURRENCY`（当前 4） |
| 支持新的 Markdown 语法 | 行内标记加进 `lib/js/blog.js` 的 `patterns` 数组；块级语法在 `renderMarkdown()` 的主循环里加分支（表格就是照这个路子加的：`splitTableRow()` / `isTableDelimiter()` / `renderTable()`） |
| 换壁纸来源 | `index.html` 的 `WALLPAPER_API`（随机入口）+ `resolveWallpaperRedirect()`（解析真实链接） |
| 改「获取当前壁纸」的下载/兜底行为 | `index.html` 的 `saveCurrentWallpaper()`（状态提示在 `#bgStatus`）与 `blobToPng()`（保存格式转换） |
| 改历史版本 / 致谢内容 | `lib/words/historylist/*.txt`、`lib/words/thanks/致谢名单.txt`（纯文本，一行一条） |
| 加一个新标签页 | 四处同步：`index.html` 侧边栏加 `.tab`（`data-tab="x"`）与 `<section id="tab-x">`、把 `#x` 加进 `VALID_TAGS`、在 `renderTab()` 里按需加载数据 |
| 改版本号 / 记录本次更新 | `README.txt` + `lib/words/historylist/RELEASE版本.txt`（沿用 `REALEASE1.1.x更新内容：…` 写法） |
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
- 注意：**本渲染器不支持多行引用**（每个 `>` 行都是独立的一段引用），所以代码块不要写在 `>` 里，否则会被拆成好几段引用、代码也不会高亮成块。

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

1. **建文件夹**：在 `lib/words/blogs/` 下新建一个目录，名字随意（建议英文/数字，如 `my_post_1`）。它既是路径名，最终也会被脚本改名为文章 id。
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
5. **放封面**：可选，`info/cover.png`。**推荐比例 4:5（0.8，略竖）**，例如 **400×500 px** 就够（卡片上最大只显示到约 80×99 px，2 倍屏也只要 160×198）；缺省时列表卡片会自动降级到 `default/info/cover.png`。详见下面的「封面比例怎么定」。
6. **跑脚本**：双击 `lib/words/blogs/update_info.bat`。它会按 `tag.txt` 第 5 行重命名文件夹（若与 id 不一致）并重建 `list.txt`（UTF-8 BOM、按 id 排序）。看到 `list.txt updated with N ID(s).` 即为成功。
7. **本地确认**：起个静态服务器（见第七节）打开 `#blog`，确认新卡片出现（标题 + 第一位作者 + 最新编辑时间）、封面/描述正常、点进去正文渲染正确、作者与最新编辑时间在元信息行最右侧。
8. **提交**：`git add` → `git commit` → `git push`；GitHub Pages 会自动发布，**无需任何构建**。顺手把本次改动写进 `lib/words/historylist/RELEASE版本.txt`（沿用 `REALEASE1.1.x更新内容：…` 写法）与 `README.txt` 的版本号。

**封面比例怎么定（按现有 CSS 推算）**

卡片是横排的 2:8 布局：`.blog-item` 宽 = 浏览区 90%，左封面 `flex: 2`、右元数据 `flex: 8`；封面 `<img>` 是 `width:100%; height:100%; object-fit:cover`，**高度由右侧文字内容撑出来**（标题 1 行 + 描述最多 2 行 ≈ 99 px，不随视口变化）。于是封面显示区是**略竖的长方形**：

| 场景 | 卡片宽 | 封面显示区 | 比例 |
|---|---|---|---|
| 桌面（>820px，容器 720px、右侧有 220px 筛选栏） | ≈400 px | ≈**80 × 99 px** | **≈0.80（4:5）** |
| 平板（641–820px，筛选栏换行到下方） | ≈360–520 px | ≈73–105 × 99 px | ≈0.73–1.06 |
| 手机（≤600px） | ≈290–340 px | ≈58–68 × 95 px | ≈0.6–0.72 |

- **结论：源图用 4:5（竖版，如 400×500 或 800×1000）最划算**——正好匹配桌面这块最常见的显示区，平板段也落在附近；想一张图通吃所有断点，退而求其次选 **1:1 正方形**，各断点的裁切量最均衡。
- 因为 `object-fit: cover` 是**居中裁切**，宽图会被切掉左右两侧：现有几张封面都是 4:3 横图（1322×991 / 1499×1124），塞进 0.8 的框里要切掉大约 40% 的宽度——**主体请放在画面中央，别把重要内容放在左右边缘**。
- 尺寸与体积：显示区极小，源图给 **400×500 就已足够**；`site_info_1/info/cover.png` 有 1322×991、**1.6 MB**，是站内最重的一张图，建议压缩（PNG 转 8-bit 调色板或用 WebP 都能大幅瘦身）。列表一次最多渲染 10 张卡片，但 `loading="lazy"` 只保证视口外的图不立刻加载，首屏那几张的体积仍会直接影响观感。

**常见坑**

- `tag.txt` 第 5 行改了却没跑脚本 → `blog.js` 按 `list.txt` 里的旧名字拼路径 → 封面与正文双双 404（正文会落到 `default/passage.md` 的"内容缺失"提示）。
- `tag.txt` 少写一行 → 后面的字段会**整体上移**（第 3 行的主题被当成作者等），因此缺行要留空行占位，不要直接省略。
- **`tag.txt` 必须凑满 5 行**（`update_info.bat` 的判断是 `$lines.Count -ge 5`）：只有前 4 行时脚本不会改名（保持文件夹名），但 `blog.js` 会用文件夹名生成 `post_xxx` 作为文章 id，导致它与 `list.txt` 里的条目**对不上**——后果是缓存比对恒判定"有新文章"，**每次打开博客都会全量重取正文**（功能正常，只是白费流量）。
- **改完文章忘了更新 `info/time.txt` 的最后一行** → 缓存认为这篇没变，读者看到的仍是旧内容。这是"更新后不刷新"的头号原因。
- **同一天里改了两次、日期却没变**（`YYYYMMDD` 精度只到天）→ 上面的判断同样认为"没变"。目前**没有**绕过办法，因为契约里判新旧只看这个日期；实在要让已缓存的读者看到新版，只能：让读者清一次站点数据，或作者在控制台执行 `window.BlogModule.refresh()` 强制重取。
- `time.txt` 必须是 `YYYYMMDD`（8 位数字）。写成 `2026年9月28日` 会被判为非法时间：排序时按 0 处理（排到最前），并且每次打开都会因 `latest` 对不上而重取这篇。
- 更新后 `list.txt` 会被脚本重写为**按 id 排序**，手工维护的顺序会被覆盖。

---

## 附录 B：一句话总览（给未来的自己）

> 这是一个"用 git 当后台、用 txt/md 当数据库"的静态站：`index.html` 管外壳与主题，`lib/js/blog.js` 管博客（缓存优先 + 有界并发加载 + 自研 Markdown（含 GFM 表格）+ HTML 白名单），`lib/words/` 里全是内容。改样式去两份 CSS 的变量，改内容加文件夹，改行为看 `blog.js`，发布只需 `git push`。
