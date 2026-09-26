# LongwaySite AI项目结构分析（供后续改动参考）

| 项 | 值 |
|---|---|
| 定稿时间 | 2026-09-26 |
| 仓库 | https://github.com/LongwayStar/longwaystar.github.io |
| 部署 | GitHub Pages，`main` 分支根目录，域名 `longwaystar.github.io` |
| 代码规模 | `index.html` 590 行 · `lib/js/blog.js` 1158 行 · 两份 CSS 共 1287 行 |

**本文覆盖面**：目录结构 → 页面架构与路由 → 七个功能模块的实现方式 → 状态与缓存键 → 改动入口速查表 → 问题清单（含历史成因与修复方案）→ 本地预览 → 验证方法 → 新增文章的完整步骤。

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
│  │  └─ blog.js               ← 博客模块全部逻辑（约 1160 行，含自研 Markdown 渲染器 + HTML 白名单清洗器）
│  ├─ icons/                   ← favicon(new_title.ico)、返回箭头(back.ico)、汉堡图标(lables_bar.png)
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

> 各项状态详见第七节，验证方式见第九节，新增文章步骤见附录 A。

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

切换逻辑集中在 `index.html` 的 `renderTab(name)`（约 411 行，只切 DOM 与按需加载，**不写 URL**）与 `showTab(name, mode)`（约 434 行，负责历史记录语义）。`showTab` 通过 `window.AppShowTab` 暴露给 `blog.js` 复用，避免重复绑定。

### 3.2 hash 路由与浏览器历史

- 标签级：`#home` / `#blog` / `#empty` / `#history` / `#settings`
- 文章级：`#blog/post/<文章 id>`（收藏夹可直达、可分享）

**导航层**（`index.html` 约 293–325 行，`window.AppNav`）：

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
- **打开网页时自动匹配浏览器**：初始化脚本位于 `index.html` 的 `<head>` 中、CSS 之前同步执行（`window.AppTheme`，约 48 行），`auto` 模式下读 `prefers-color-scheme` 决定亮暗，因此**首屏就是正确主题，不会闪烁**（原 P6 一并解决）。
- **实时跟随**：`auto` 模式下监听 `matchMedia('(prefers-color-scheme: dark)')` 的 `change`，系统主题一变页面立刻跟着变；一旦手动固定就停止跟随。
- 侧边栏 `.theme-toggle`：在 `auto` 下取当前生效值的**反色**作为显式选择（即"现在深色 → 点一下固定为浅色"）；设置页「关于主题」卡片显示当前状态并提供**「跟随浏览器主题」**按钮回到 `auto`。状态文案由 `updateThemeUI()`（约 333 行）维护，站主润色后为：跟随态显示「当前已跟随浏览器主题」，固定态显示「当前主题已更改，点击下方按钮恢复自动切换」（**只提示状态迁移，不再复述具体是深色还是浅色**——具体色号由侧边栏按钮的图标与文案承担）。


### 4.2 侧边栏收起 / 展开

- `.sidebar-toggle` 按钮切换 `.layout.collapsed` 类，CSS 用 `width/margin-left` 过渡实现动画。
- 桌面端记忆到 `localStorage.sidebarCollapsed`；≤640px 时侧边栏变顶部横向栏（CSS 媒体查询），JS 用 `isDesktopSidebar()` 判断，移动端不读取收起记忆。

### 4.3 背景（随机壁纸）

- 来源：第三方 API `https://t.alcy.cc/ycy?t=<时间戳>`（时间戳用于绕过缓存，`backgroundUrl()`）。
- 刷新流程 `refreshBackground()`：先 `new Image()` 预加载 → `onload` 时读取 `img.currentSrc`（拿到重定向后的**真实静态图片地址**，保证与屏幕显示一致）→ 写到 `document.body.style.backgroundImage`。
- 入口有两处：侧边栏"刷新背景"按钮、设置页"刷新背景"按钮。
- CSS 中的 `body { background-image: url('https://t.alcy.cc/ycy') }` 只是首屏默认值，JS 加载后会覆盖。

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
   └─ cover.png        列表封面（可选；缺失时由卡片 <img onerror> 降级到 default 封面）
```

`default/` 兜底目录（同样遵循上面的结构，只有 2 行 tag.txt——后三行留空，这样缺日期/主题的文章不会被塞进假数据）：

```
default/
├─ passage.md          ← 提示"内容缺失"的说明性正文
└─ info/{tag.txt, cover.png}
```

`tag.txt` 行序（`loadArticle()`，`blog.js` 约 380 行）：

| 行 | 含义 | 备注 |
|---|---|---|
| 1 | 标题 | 前导 `#` 会被去掉 |
| 2 | 描述 | 列表卡片摘要，最多显示 2 行 |
| 3 | 修改日期 | 必须是 `YYYY年M月D日` 格式，否则"按时间排序"视为 0 |
| 4 | 主题 | 会去掉前导 `#`，用于主题胶囊与精确筛选 |
| 5 | 文章 id | 缺失时由文件夹名生成 `post_<净化后名字>`；也是 `update_info.bat` 重命名文件夹的目标名 |

#### 加载流水线（`ensureLoaded()`，`blog.js` 约 861 行）

```
读 localStorage 缓存(longwebBlogV1)
   ├─ 命中 → applyCache()：立即渲染列表/统计；若是直达文章再直接 openArticle(a, 'none')
   ↓
fetch list.txt（唯一的轻量请求）
   ├─ 失败 → 有缓存则继续用缓存，无缓存则显示"加载失败"
   ├─ id 集合与缓存完全一致 → 不重新拉正文；同时剔除缓存里已被删除的文章并回写缓存
   └─ 有新增 → setProgress() 显示进度条
        ↓
loadArticles(ids)：有界并发（CONCURRENCY = 4）逐篇 loadArticle()
   ├─ 进度回调 setProgress('determinate', …, pct)（封顶 99%）
   ├─ 首次加载时每成功一篇就 renderLoading() 增量上屏（无筛选/排序时才启用）
   ↓
全部完成 → 覆盖 articles、重建 idMap、writeCache()、hideProgress()、renderList()、bindFilter()
   └─ 若存在 pendingPostId（hash 直达）→ 用最新数据 openArticle(a, 'none') 或回列表
```

设计要点：**首屏快**（缓存直出）、**省流量**（无新文章不拉正文）、**最终一致**（有新增则整批重取，避免缓存里旧正文）。

#### 筛选 / 排序 / 分页

- 状态为模块级变量：`filterName`（模糊，匹配标题或文件夹名）、`filterTheme`（**精确**匹配）、`sortKey`（`name`/`time`/`null`）、`sortDir`、`page`。
- 筛选优先级：主题精确筛选 → 名称模糊筛选 → 排序；名称/主题输入框有 200ms 防抖。
- 排序：名称用 `localeCompare(…, 'zh-CN')`；时间用 `parseDate()` 解析中文日期。
- 分页：`PER_PAGE = 10`，`renderPager(pages)` 生成「‹ 1 2 3 ›」式分页器（含首尾禁用态）。
- 交互细节：点击卡片→读文章；点击**主题胶囊**→只触发 `setFilterByTheme()`（`stopPropagation` + `preventDefault`，既阻止读文章也阻止外层 `<a>` 的默认跳转）。

#### 阅读视图

- `openArticle(a, mode)`（约 686 行）：隐藏列表/筛选区/分页器，显示 `#blogReadView`，把 URL 换成 `#blog/post/<id>`，并把网页标题改成 `LongWeb-<文章标题>`；正文由 `renderMarkdown(a.body, a.folder)` 渲染。`mode` 见 §3.2：`'push'`（用户点卡片，默认）或 `'none'`（URL 已就位：直达链接 / 前进后退）。
- `closeArticle()`（约 728 行）：反向操作，标题恢复 `LongWeb`，hash **替换**回 `#blog`，并清空 `pendingPostId`（用户主动返回即放弃直达目标）。
- 直达两种路径：缓存命中 → 立即阅读（无进度条）；未命中 → `enterReadingPlaceholder(id)` 先显示骨架 + 不确定态进度条，加载完成后填充。

#### 自研 Markdown 渲染器（`parseInline` 约 93 行 / `renderMarkdown` 约 281 行）

支持：`#`~`######` 标题、`>` 引用、`-`/`*` 无序列表、`1.` 有序列表、`---` 分割线、**GFM 表格**、围栏代码块（含语言 → `class="language-x"`）、行内代码 `code`、`~~删除线~~`、`**粗体**`、`*斜体*`/`_斜体_`、`![alt](src)` 图片、`[text](href)` 链接。
  > 注意：行内代码只认**单个反引号**，Markdown 里用双反引号包裹代码的写法（用来在代码里再套反引号）**不被支持**，会被拆得七零八落——正文里请避开这种写法。

- **嵌套支持**：`parseInline()` 不断找"最早出现的标记"递归解析，所以 `~~_斜体_~~` 可正常嵌套。
- **表格（GFM 风格，2026-09 新增）**：表头行 + 分隔行即可成表，列数由表头决定。
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
- **安全模型**：先 `escapeHtml()` 再解析 → 普通文本里的 HTML 被转义；**整行形如 `<...>` 的行会走白名单清洗后放行**（`sanitizeHtml()`，`blog.js` 约 151–275 行的清洗器区块）——危险标签丢弃、未知标签拆壳、`on*` 与未知属性移除、URL 协议校验，详见 P8。正文作者虽然能写 HTML，但已无法执行脚本。
- **文章卡片**：`<a class="blog-item" href="#blog/post/<id>">`（真链接，支持中键/Ctrl+点击新标签页打开），左键点击由 JS 接管并 `pushState`。
- **图片/链接路径解析** `resolveAssetPath()`：`http(s)://`、`//`、`data:`、`/` 开头原样保留；相对路径（如 `img/1.jpg`）自动拼成 `lib/words/blogs/<文章文件夹>/img/1.jpg`，即每篇文章的插图放在自己的文件夹里。
  > 顺序陷阱：**任何 URL 都必须先 `isSafeUrl()` 校验、再 `resolveAssetPath()` 解析**。反过来会把 `javascript:...` 拼成 `lib/words/blogs/<文章>/javascript:...` 这种长相安全、从而漏判的相对路径（P8 修复时踩过，已被回归测试抓出）。
- 局限：**Markdown 语法本身**不支持脚注、段落内换行合并（空行会产生空 `<p></p>`）、引用/列表的多层嵌套；脚注等复杂排版需写成原始 HTML 行（走白名单放行）。跨行 HTML 结构仍不是真正的块级 HTML，`<div>` 与 `</div>` 分行写会被 `<p>` 打断（见 P8"仍未覆盖"）。

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
| `longwebBlogV1` | localStorage | `{ articles: [...], savedAt }` | 与 `list.txt` 比对，有新增则全量重取；已删除的文章会被剔除并回写 |
| `LongwaySiteHistoryRelease` | localStorage | RELEASE 版本行数组 | 每次进入面板静默刷新 |
| `LongwaySiteHistoryBeta` | localStorage | BETA 版本行数组 | 同上 |
| `LongwaySiteThanks` | localStorage | 致谢名单行数组 | 同上 |

> 调样式或改数据格式后若看不到变化，先清一次 `localStorage`（缓存优先策略会让旧数据继续显示）。`BlogModule.refresh()`（`window.BlogModule` 上）可强制重取文章数据。

---

## 六、改动入口速查表

| 想做的事 | 改哪里 |
|---|---|
| 发一篇新文章 | 新建 `lib/words/blogs/<名字>/`：`passage.md` + `info/tag.txt` + `info/cover.png`（可选 `img/`），跑一次 `update_info.bat`。三者都可缺省，会分别落到 `default/` |
| 改文章标题/描述/日期/主题/id | 该文章的 `info/tag.txt`（改 id 后必须跑 `update_info.bat`） |
| 加/删/排序文章 | 直接编辑 `lib/words/blogs/list.txt`（或让脚本重建） |
| 改全站配色、玻璃感、圆角、字体、间距 | `lib/css/generalstyle.css` 的 `:root` / `[data-theme="dark"]` 变量 |
| 改主题跟随策略（默认是否跟随系统、开关入口） | `index.html` 的 `<head>` 脚本（`window.AppTheme`）+ 设置页「关于主题」卡片 |
| 允许正文使用更多 HTML 标签 / 恢复 `<iframe>` | `lib/js/blog.js` 的 `HTML_ALLOWED_TAGS` / `HTML_DROP_TAGS` 常量 |
| 调整站内导航语义（返回按钮、历史条目） | `index.html` 的 `window.AppNav` + `showTab(name, mode)`；`blog.js` 的 `openArticle(a, mode)` |
| 改博客卡片比例、筛选栏宽度、阅读排版 | `lib/css/blog.css`（卡片 2:8 在 `.blog-item-cover` / `.blog-item-meta`） |
| 改表格 / 阅读区其他排版样式 | `lib/css/blog.css` 的 `.blog-read-content table`、`.md-table-wrap` |
| 改每页条数 | `lib/js/blog.js` 的 `PER_PAGE`（当前 10） |
| 改并发数（加载速度 vs 请求数） | `lib/js/blog.js` 的 `CONCURRENCY`（当前 4） |
| 支持新的 Markdown 语法 | 行内标记加进 `lib/js/blog.js` 的 `patterns` 数组；块级语法在 `renderMarkdown()` 的主循环里加分支（表格就是照这个路子加的：`splitTableRow()` / `isTableDelimiter()` / `renderTable()`） |
| 换壁纸来源 | `index.html` 的 `backgroundUrl()` + `generalstyle.css` 的 `body { background-image }` |
| 改历史版本 / 致谢内容 | `lib/words/historylist/*.txt`、`lib/words/thanks/致谢名单.txt`（纯文本，一行一条） |
| 加一个新标签页 | 四处同步：`index.html` 侧边栏加 `.tab`（`data-tab="x"`）与 `<section id="tab-x">`、把 `#x` 加进 `VALID_TAGS`、在 `renderTab()` 里按需加载数据 |
| 改版本号 / 记录本次更新 | `README.txt` + `lib/words/historylist/RELEASE版本.txt`（沿用 `REALEASE1.1.x更新内容：…` 写法） |
| 清掉本地缓存看真实效果 | 浏览器开发者工具 → Application → Local Storage（键名见第五节） |

---

## 七、已知问题清单（P1~P3、P5~P8 已修复；P4 经确认不改；P9 为遗留小瑕疵）

### P1（高）✅ 已修复：兜底目录缺失

**原状**：`blog.js` 文件头注释、`loadArticle()` 引用的 `lib/words/blogs/.Default/` 在**工作区和 git 历史中都从未存在**（`git log --all -- "*Default*"` 为空）。后果：缺 `passage.md` 的文章正文为空，缺 `cover.png` 的文章封面 404 破图（`<img onerror>` 也指向同一个不存在的文件）。

**修复方式（采用方案 B：改名，规避点目录）**：
- 新建 `lib/words/blogs/default/`，含 `passage.md`（站主手写的"内容缺失"提示）、`info/tag.txt`（2 行：`未命名文章` / `暂无描述`，后 3 行留空以免污染日期与主题）、`info/cover.png`。
- `blog.js` 新增常量 `DEFAULT_FOLDER` / `DEFAULT_BASE` / `DEFAULT_COVER` 与保留名数组 `RESERVED_FOLDERS = ['default', '.Default']`；`fetchFolderIds()` 用它过滤清单，卡片 `onerror` 用 `DEFAULT_COVER`。
- `update_info.bat` 的目录排除条件改为 `@('default', '.Default') -notcontains $_.Name`。

> ⚠️ **`default/info/cover.png` 是站主有意指定的兜底图（约 217 KB），不是占位图，请勿重新生成或替换**；`default/passage.md` 同样由站主自行撰写。

**为什么用非点开头的 `default`**：GitHub Pages 默认走 Jekyll 构建，Jekyll 会忽略以 `.` 开头的目录，兜底资源在线上仍会 404；改名后同时兼容 Jekyll 与 `.nojekyll` 两种发布方式，无需额外文件。

**验证**：跑 `update_info.bat` 后 `list.txt` 仍为 2 条（`default` 未被误收录）；本地静态服务器上 `default/{passage.md, info/tag.txt, info/cover.png}` 全部 200；用 Node 复刻 `loadArticle()` 逻辑请求不存在的文章，标题/描述/正文正确落到兜底值、封面请求 404 后由 `onerror` 降级到 200 的兜底封面。

### P2（中）✅ 已修复：`bindFilter()` 被重复调用

原代码在 `applyCache()`、fresh load 的 `.then`、末尾 `if (!readingArticle)` 分支共调用 3 次 `bindFilter()`，输入框防抖后会执行多份 `renderList()`。
修复：新增模块级 `let filterBound = false`，`bindFilter()` 函数体首行加 `if (filterBound) return; filterBound = true;`（筛选区是 `index.html` 里的静态 DOM，只需绑定一次）。同时删除了 `.then` 中末尾重复的 `renderList(); bindFilter();` 分支与冗余的 `renderStat()`（`renderList()` 内部已调用）。

### P3（中）✅ 已修复：封面存在性检测会整张下载图片

原 `loadArticle()` 用 `await fetchText(base + 'info/cover.png')` 判断封面是否存在，会把整张 PNG 当文本下载（`site_info_1/info/cover.png` 达 **1.6 MB**），每篇文章白白多一次大流量请求。
修复：删除该探测，`cover` 一律取约定路径，缺失时交由卡片 `<img onerror>` 降级到兜底封面（零额外请求）。

### P4（中）外部依赖可用性 —— ❎ 经确认无需改动

- B站信息卡依赖第三方 API `https://bili-card.130923.xyz/api/card?uid=673847297`（主页卡片），该服务失效即破图。
- 壁纸依赖 `https://t.alcy.cc/ycy`，同理。
- **结论**：站主确认这是可接受的取舍，保持现状，不再加 `onerror` 兜底。

### P5（低）✅ 已修复：文档版本号不一致

`README.txt` 原写「目前版本:RELEASE1.1.2」，落后于 `RELEASE版本.txt`。现已同步为 **REALEASE1.1.4**（"bug修复，优化加载逻辑"），`RELEASE版本.txt` 也补上了 1.1.4 条目。
> 注：`REALEASE` 是仓库中沿用已久的拼写（应为 `RELEASE`），站主选择保留既有写法以与历史记录一致——后续新增条目请沿用同一写法，避免出现两种拼写混排。

### P6（低）✅ 已修复：首屏主题闪烁（FOUC）

主题初始化原本写在 `</body>` 前的脚本里，浏览器会先用默认亮色变量渲染一帧再切暗色。
修复：主题逻辑整体搬到 `index.html` 的 `<head>` 中、样式表之前同步执行（`window.AppTheme`），并把侧边栏按钮的文案/状态同步留在页面底部脚本里。这同时也是"打开网页时自动匹配浏览器主题"功能的实现基础。

### P7（低）✅ 已修复：hash 路由无历史栈

**修复前表现（能感知到的问题）**

1. **浏览器"后退"键会直接离开站点**——在主页点「我的博客」、再点开一篇文章，此时按浏览器后退，不会退回列表、也不会退回主页，而是回到进入本站之前的上一个网页。对单页应用来说这是最反直觉的一点。
2. **"前进"键永远灰着**（除非离开本站），因为整个访问过程在浏览器看来只有 1 条历史记录。
3. **标签切换无法撤销**：从主页 → 博客 → 历史版本 → 设置，没有任何办法用后退逐级返回。
4. **站内跳转不能"新标签页打开"**：文章卡片是 `<article>` + click 监听（不是 `<a href="#blog/post/x">`），中键 / Ctrl+点击 / 右键"在新标签页中打开"全部无效。
5. 从外部链接（收藏夹、他人分享的 `#blog/post/<id>`）进来后，后退同样直接离开站点，而不是回到博客列表。
6. 刷新仍能停在当前标签/当前文章（因为 hash 已写入地址栏），**只有历史栈这一项是坏的**。

**成因**

- `showTab()` 与 `openArticle()` / `closeArticle()` 都用 `history.replaceState(...)` —— **替换**当前历史条目而不是 `pushState` **新增**。`replaceState` 的设计语义恰恰是"我不想让用户回到这里"，这里被当成普通路由跳转用了。
- 监听器其实不缺（原本已有 `hashchange`）：hash-only 的 URL 前进/后退**本来就会触发 `hashchange`**，真正的问题是从来没有产生过可回退的条目。
- 埋着的坑：首屏初始化与用户点击**共用**同一个 `showTab()`，直接全换 `pushState` 会让首屏压入重复记录。

**修复方案**

- `index.html` 新增导航层 `window.AppNav`（`push` / `replace` / `canGoBack` / `goBack`）：用户点击 → `pushState({navIdx})`；首屏初始化与状态修正 → `replaceState`；`showTab(name, mode)` 用 `mode` 明确区分 `'push' | 'replace' | 'none'`。
- 新增 `popstate` 监听按 hash 重建视图；文章级 hash 交给 `blog.js` 独占处理（保留"先开文章再激活标签"的顺序，避免 `ensureLoaded` 抢跑）。
- `navIdx` 层数守卫：只有 `navIdx > 0` 才 `history.back()`，**直达链接场景绝不会把用户带出站点**，而是退化为 `replace('#blog')`。
- 阅读页「返回」按钮优先走 `AppNav.goBack()`（真回退，符合直觉）；文章不存在等状态修正路径用 `replace`，不在历史里新增条目。
- `popstate` 与 `hashchange` 合并调度（`scheduleHandleHash`，`setTimeout 0`），避免一次跳转处理两遍。
- 文章卡片由 `<article>` 改为真链接 `<a class="blog-item" href="#blog/post/<id>">`（`blog.css` 补 `text-decoration:none; color:inherit`），恢复中键 / Ctrl+点击新标签页打开；左键仍由 JS 接管（`preventDefault` + `pushState`），带修饰键的点击则放行给浏览器原生行为。

### P8（低）✅ 已修复：Markdown 直通原始 HTML

**修复前表现**

1. **带事件处理器的 HTML 会真的执行 JS**：正文里写一行 `<img src=x onerror="...">` 或 `<svg onload="...">`，这段 JS 就跑在读者浏览器里，权限与页面等同（可读写 `localStorage` 中的 `theme`、`longwebBlogV1` 等缓存）。**注意**：因为正文用 `innerHTML` 注入，`<script>` **不会**执行，真正能落地的是事件处理器元素与 `<iframe>`、外链资源——所以不是"能跑 `<script>`"那么夸张，但同样是任意代码执行面。
2. **"整行 HTML"与"行内 HTML"行为不一致**：只有整行匹配 `/^<.*>$/` 才放行，`前面文字 <b>加粗</b> 后面文字` 里的 `<b>` 会被转义成可见文本。
3. **HTML 行内的 Markdown 不生效**：`<div>**加粗**</div>` 里的 `**` 不会被渲染。
4. **跨行 HTML 结构会被拆坏**：`<div>` 与 `</div>` 分处两行时，中间的行仍会被套上 `<p>`，产生非法嵌套。
5. **当时风险等级低**（正文只有站主自己通过 git 提交），但引入任何第三方内容即升级为真实 XSS。

**成因**

- `renderMarkdown()` 在代码块与空行判断之后有一段显式放行分支：`if (/^<.*>$/.test(t)) { html += t; continue; }`——这是**有意设计**（要支持 HTML/CSS 示例），但它**绕过了**渲染器原本唯一的安全模型"先 `escapeHtml()` 再解析行内标记"，于是"转义"与"直通"两套规则并存，边界就是"整行是不是 HTML"。
- 最终输出用 `innerHTML` 赋值，因此任何进入 HTML 的事件处理器都会生效。

**修复方案**（保留"能写 HTML/CSS 示例"的设计意图，只给放行加边界）

- 放行分支改为 `sanitizeHtml(t, folder)`，实现见 `blog.js` 约 150–275 行：
  - 用 `<template>` 承载待清洗内容（惰性文档：脚本不执行、图片不发请求，**清洗过程本身无副作用**）；
  - 危险标签**整段丢弃**：`script / iframe / object / embed / applet / frame / frameset / form / input / button / select / option / textarea / label / link / meta / base / svg / math`；
  - 不在白名单的标签**拆壳**（丢掉标签本身、保留并继续清洗其内容），所以 `<unknown-tag>文字</unknown-tag>` 只留下文字；
  - 所有 `on*` 事件属性与未知属性一律移除；`data-*` / `aria-*` 放行；`style` 额外拦掉 `expression(...)`；
  - `href / src / poster` 走 `isSafeUrl()` 协议校验（拦 `javascript:` / `vbscript:` / `file:` / `blob:` 等，`data:` 仅放行图片），通过后仍按文章文件夹解析相对路径——**原始 HTML 里的 `<img src="img/1.jpg">` 现在也能正确加载了**。
- 顺带收紧了 Markdown 自身的链接与图片：`[x](javascript:...)` 被降级为纯文字、`![x](javascript:...)` 退化为替代文字。
  > 这里踩过一个坑并已修正：**必须先校验原始值再调用 `resolveAssetPath()`**。颠倒顺序时 `javascript:...` 会被当成相对路径拼成 `lib/words/blogs/<文章>/javascript:...`，长相安全从而漏判（这个 bug 正是被 jsdom 回归测试抓出来的）。
- **HTML 行内的行内 Markdown 现在会解析**（`<div>**粗体**</div>` → `<strong>`），`<pre>` / `<code>` / `<style>` 内部保持原样；因此原表现第 3 条一并解决。

**仍未覆盖**（有意保留的边界）

- 第 2 条：普通文本行里写 `<b>` 仍会被转义成可见文本——这是"行内 HTML 不开放"的设计，不是 bug。
- 第 4 条：跨行 HTML 仍不是真正的 Markdown "HTML block"，`<div>` 与 `</div>` 分行写依旧会被 `<p>` 打断。若确实需要，可再实现块级 HTML 收集。
- `<style>` 在允许列表内（CSS 示例需要它），因此正文里的 CSS **可以**影响整页样式（例如 `body{display:none}`）。这是站主自伤范畴，不算漏洞；若要收紧可把 `style` 从白名单移除，或改成只允许内联 `style` 属性。

**回归验证**：用 jsdom 加载真实页面 + 一篇临时"XSS 载荷夹具"文章，46 项断言全部通过（详见第九节）。站主随后只改了设置页的主题状态文案，不涉及这些断言的行为。

### P9（低）其他小瑕疵

- `renderLinesTo(container, lines, emptyText, errText)` 的 `errText` 参数从未使用（死参数）。
- `lib/css/blog.css` 的 `.blog-reset-btn` 样式没有对应元素（页面用的是 `#blogSortReset` + `.blog-sort-btn`）。
- `lib/css/generalstyle.css` 的 `.infocard img` 是后代选择器，但页面上 `<img class="infocard">` 自身就是图片，该规则不生效（生效的是 `.infocard { width: 80% }`）。
- `lib/words/blogs/test_1/passage.md` 内容为 `<h1>Hello World!<h1/>`，闭合标签写错（应为 `</h1>`）。`othersite/testground/index.html` 同样是坏的 `<h1/>`。
- `tag.txt` 第 3 行日期写的是 `2026年9月2日`（未来年份），排序/显示会照此呈现，若非笔误建议修正。
- `lib/images/`、`lib/fonts/` 为空目录（仅占位 readme）。
- 页脚版权写 "Created by LongwayStar in 2026"。

---

## 八、本地预览提示

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

## 九、本次改动的验证方式（可复用）

改动最终用 **jsdom 端到端回归**验证：装一个临时 `jsdom`（`npm i jsdom --prefix .tmp-test --cache .tmp-test/npm-cache`，注意 npm 默认缓存目录可能被沙箱拒绝，需用 `--cache` 指到仓库内），用 `JSDOM.fromURL` 加载**真实的** `index.html`（`runScripts: 'dangerously'` + `resources: 'usable'`），并在 `beforeParse` 里补两样 jsdom 缺失的东西：

- `window.fetch`（转发到 Node 的 `globalThis.fetch`）；
- `window.matchMedia`（可注入"系统是否为深色"）。

再准备临时的"夹具"文章——`_sectest/`（载荷夹具：`<img onerror>`、`<svg onload>`、`<script>`、`javascript:` 链接、实体编码变体、`<iframe>`、未知标签、跨行元素等）与 `_tabletest/`（表格边界夹具：对齐、代码里的竖线、`\|` 转义、单列、缺列/多列、紧邻列表、文件结尾无空行、代码块内的表格）——把它们临时加进 `list.txt`，跑完**逐字节还原** `list.txt` 并删除夹具。

覆盖的断言分四组：

1. **P8 白名单过滤**（46 项）：脚本未执行、`on*` 全清、危险标签整段丢弃、`javascript:`（含大小写混淆与实体编码）被剥离、白名单标签与 `<style>`/`<pre>` 保留、未知标签拆壳留文字、HTML 行内 Markdown 生效、相对路径图片解析正确。
2. **P7 导航**：点标签产生历史、点卡片进阅读视图、浏览器后退回到列表、前进重新进入文章；「返回」按钮走真回退；直达链接（无站内历史）点「返回」回列表且 hash 不被改写。
3. **主题三态**：打开时按系统渲染、默认 `auto`、点击固定为另一色并写入 `localStorage`、点「跟随浏览器主题」回到 `auto` 并清除存储、刷新后仍跟随。
4. **表格渲染**（33 项，2026-09 新增）：真实文章渲染出的表格数量与**源码独立数出来的数量**一致（7 张）；对齐三态、代码块内的竖线与 `\|` 转义不切分单元格、单列表格、缺列补空与多列裁剪、紧邻列表的表格、文件结尾无空行也能解析、代码块内的表格不解析、普通段落里的竖线仍是段落；并顺带确认新增表格分支不影响原始 HTML 的白名单清洗。

> 写断言的小技巧：**别硬编码"应该有 5 行"这类数字**——第一版测试就是这么写出 4 个"失败"的，核对源码后发现全是预期写错（表格其实 4 行数据、夹具其实 6 张表）。改成"用独立实现从源码数一遍，再和 DOM 对照"之后，测试才真正在验证代码。

> 验证环境说明：本机沙箱禁止启动 Edge/Chrome 无头浏览器（`Access is denied`），因此用 jsdom 代替真实浏览器；jsdom 覆盖 DOM/JS 行为，但**不覆盖真实排版与视觉**，涉及 CSS 的改动（例如文章卡片由 `<article>` 变 `<a>`）建议在浏览器里再肉眼确认一次。

---

## 附录 A：新增一篇文章的完整步骤（最常用操作）

1. **建文件夹**：在 `lib/words/blogs/` 下新建一个目录，名字随意（建议英文/数字，如 `my_post_1`）。它既是路径名，最终也会被脚本改名为文章 id。
2. **写正文**：在该目录下新建 `passage.md`（UTF-8 **无 BOM**）。语法见 §4.5；插图放进 `img/` 子目录，用相对路径引用：`![说明](img/1.jpg)`。
3. **写元数据**：新建 `info/tag.txt`（UTF-8 **无 BOM**），**严格 5 行**：

   ```
   文章标题
   一句话描述（列表摘要，最多显示 2 行）
   2026年9月26日
   #主题名
   my_post_1
   ```

   - 第 3 行必须是 `YYYY年M月D日`，否则"按时间排序"会把它当成 0；
   - 第 4 行的 `#` 会被自动去掉，值用于主题胶囊与"按主题精确筛选"；
   - 第 5 行是**文章 id**，会同时成为文件夹名与 `#blog/post/<id>` 里的 id，**必须与文件夹名一致**（由第 5 步的脚本负责改名保证）。
4. **放封面**：可选，`info/cover.png`。**推荐比例 4:5（0.8，略竖）**，例如 **400×500 px** 就够（卡片上最大只显示到约 80×99 px，2 倍屏也只要 160×198）；缺省时列表卡片会自动降级到 `default/info/cover.png`。详见下面的「封面比例怎么定」。
5. **跑脚本**：双击 `lib/words/blogs/update_info.bat`。它会按 `tag.txt` 第 5 行重命名文件夹（若与 id 不一致）并重建 `list.txt`（UTF-8 BOM、按 id 排序）。看到 `list.txt updated with N ID(s).` 即为成功。
6. **本地确认**：起个静态服务器（见第八节）打开 `#blog`，确认新卡片出现、封面/描述/日期正常、点进去正文渲染正确。
7. **提交**：`git add` → `git commit` → `git push`；GitHub Pages 会自动发布，**无需任何构建**。顺手把本次改动写进 `lib/words/historylist/RELEASE版本.txt`（沿用 `REALEASE1.1.x更新内容：…` 写法）与 `README.txt` 的版本号。

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
- `tag.txt` 少写一行 → 后面的字段会**整体上移**（第 3 行的主题被当成日期等），因此缺行要留空行占位，不要直接省略。
- **`tag.txt` 必须凑满 5 行**（`update_info.bat` 的判断是 `$lines.Count -ge 5`）：只有前 4 行时脚本不会改名（保持文件夹名），但 `blog.js` 会用文件夹名生成 `post_xxx` 作为文章 id，导致它与 `list.txt` 里的条目**对不上**——后果是缓存比对恒判定"有新文章"，**每次打开博客都会全量重取正文**（功能正常，只是白费流量）。
- 浏览器看不到更新时：`localStorage` 的 `longwebBlogV1` 缓存与 `list.txt` 比对后才会重取；若确认 `list.txt` 已更新却仍是旧的，清一次站点数据即可。
- 更新后 `list.txt` 会被脚本重写为**按 id 排序**，手工维护的顺序会被覆盖。

---

## 附录 B：一句话总览（给未来的自己）

> 这是一个"用 git 当后台、用 txt/md 当数据库"的静态站：`index.html` 管外壳与主题，`lib/js/blog.js` 管博客（缓存优先 + 有界并发加载 + 自研 Markdown（含 GFM 表格）+ HTML 白名单），`lib/words/` 里全是内容。改样式去两份 CSS 的变量，改内容加文件夹，改行为看 `blog.js`，发布只需 `git push`。

