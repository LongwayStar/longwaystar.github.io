/* ============================================================
   LongwaySite 我的博客模块 (blog.js)
   依赖：无（原生 JS）
   数据：lib/words/blogs/
     - list.txt：文章文件夹清单（每行一个文件夹名，不含 default）
     - default/：默认数据（passage.md / info/cover.png / info/tag.txt）
     - <文章文件夹>/passage.md + info/{cover.png, tag.txt}
   tag.txt 五行：标题 / 描述 / 修改日期 / 主题 / 文章 id
   文件缺失或格式不规范时，用 default 对应数据兜底
   注意：兜底目录名为 default（非点开头），避免 GitHub Pages 的
   Jekyll 构建忽略以 . 开头的目录导致兜底资源 404
   ============================================================ */
(function() {
    'use strict';

    const BLOG_BASE = 'lib/words/blogs/';
    // 兜底数据目录名（同时是 list.txt 中需要过滤掉的保留名）
    const DEFAULT_FOLDER = 'default';
    const DEFAULT_BASE = BLOG_BASE + DEFAULT_FOLDER + '/';
    const DEFAULT_COVER = DEFAULT_BASE + 'info/cover.png';
    // 历史遗留名（旧版曾使用 .Default，此处置于过滤名单以防误收录）
    const RESERVED_FOLDERS = [DEFAULT_FOLDER, '.Default'];

    /* ---------- 本地缓存 ---------- */
    const CACHE_KEY = 'LongwaySiteBlogV1';
    // 读缓存：成功返回 { articles, idMap }，无缓存/损坏返回 null
    function readCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.articles) || data.articles.length === 0) return null;
            // 简单校验：每项须有 id
            const ok = data.articles.every(function(a) { return a && a.id && a.folder; });
            if (!ok) return null;
            return { articles: data.articles, idMap: buildIdMap(data.articles) };
        } catch (e) { return null; }
    }
    function writeCache(articles) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ articles: articles, savedAt: Date.now() }));
        } catch (e) { /* 容量不足/隐私模式：静默失败 */ }
    }

    /* ---------- 状态 ---------- */
    let articles = [];        // 全部文章（含兜底后数据）
    let idMap = {};           // id → article 索引
    let filterName = '';      // 名称模糊搜索词
    let filterTheme = '';     // 主题精确筛选词
    let sortKey = 'name';     // 'name' | 'time'（始终有排序方式：默认按名称，按钮常亮高亮）
    let sortDir = 'asc';      // 'asc' | 'desc'
    let page = 1;             // 当前页
    const PER_PAGE = 10;      // 每页最多 10 条
    let loaded = false;
    let loading = false;      // 是否正在加载中（增量渲染期间为 true）
    let filterBound = false;  // 筛选/排序事件是否已绑定（只绑定一次）
    let totalCount = 0;       // list.txt 中的文章总数（进度条分母）
    let pendingPostId = null; // hash 直达的文章 id（加载完成前暂存）
    let readingArticle = null; // 正在阅读的文章（null=列表态）

    /* ---------- 简易 Markdown / HTML 渲染（支持嵌套语法与文章图片） ---------- */
    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 解析图片引用路径：相对路径（如 img/xxx.png）转为文章文件夹下的绝对路径
    function resolveAssetPath(folder, path) {
        if (!path) return path;
        const p = String(path).trim();
        // 外部链接 / 绝对路径 / 协议相对路径 原样保留
        if (/^(https?:)?\/\//.test(p) || /^data:/i.test(p) || p.charAt(0) === '/') return p;
        if (!folder) return p;
        // 相对路径：拼接文章文件夹
        return BLOG_BASE + encodeURIComponent(folder) + '/' + p.replace(/^\.\//, '');
    }

    // 校验 URL 是否安全：拦掉可执行脚本的协议。
    // 判断时把空白与控制字符全部去掉（防 `java\nscript:` 这类绕过），
    // 但真正写入属性的仍是原值，避免破坏带空格的正常路径
    function isSafeUrl(raw) {
        const s = String(raw == null ? '' : raw).trim();
        if (s === '') return false;
        const compact = s.replace(/[\u0000-\u0020\u007F]+/g, '').toLowerCase();
        if (/^(javascript|vbscript|file|blob|about|chrome|jar|view-source)/.test(compact)) return false;
        // data: 仅允许图片（data:image/...）
        if (compact.indexOf('data:') === 0 && compact.indexOf('data:image/') !== 0) return false;
        return true;
    }

    // 递归解析行内标记，支持嵌套（如 ~~_斜体_~~）
    // text 已转义；在任意位置查找最早的特殊标记
    function parseInline(text, folder) {
        if (text === '') return '';
        const patterns = [
            { re: /`([^`]+)`/, wrap: (inner) => '<code>' + inner + '</code>' },
            { re: /~~([\s\S]+?)~~/, wrap: (inner) => '<del>' + inner + '</del>' },
            { re: /\*\*([\s\S]+?)\*\*/, wrap: (inner) => '<strong>' + inner + '</strong>' },
            { re: /!\[([^\]]*)\]\(([^)]*)\)/, wrap: (inner, alt, src) => {
                // 必须先校验原始值再解析相对路径：resolveAssetPath 会把
                // "javascript:..." 当成相对路径拼成安全长相的 URL，颠倒顺序会漏判
                if (!isSafeUrl(src)) return alt || ''; // 不安全：退化为替代文字
                return '<img src="' + resolveAssetPath(folder, src) + '" alt="' + alt + '">';
            } },
            { re: /\[([^\]]+)\]\(([^)]*)\)/, wrap: (inner, label, href) => {
                if (!isSafeUrl(href)) return label; // 不安全：只保留链接文字
                return '<a href="' + resolveAssetPath(folder, href) + '" target="_blank" rel="noopener">' + label + '</a>';
            } },
            { re: /\*([^*]+)\*/, wrap: (inner) => '<em>' + inner + '</em>' },
            { re: /_([^_]+)_/, wrap: (inner) => '<em>' + inner + '</em>' }
        ];
        // 查找最早出现的标记
        let earliest = -1, earliestIdx = -1;
        for (let i = 0; i < patterns.length; i++) {
            const m = patterns[i].re.exec(text);
            if (m && (earliest === -1 || m.index < earliest)) {
                earliest = m.index;
                earliestIdx = i;
            }
        }
        if (earliestIdx === -1) {
            return text; // 无更多标记
        }
        const pat = patterns[earliestIdx];
        const m = pat.re.exec(text);
        // 标记前的普通文本
        const prefix = text.slice(0, m.index);
        const rest = text.slice(m.index + m[0].length);
        let inner;
        if (earliestIdx === 0) {
            // 行内代码内容不递归（原样）
            inner = m[1];
            return prefix + pat.wrap(inner) + parseInline(rest, folder);
        }
        if (earliestIdx === 3 || earliestIdx === 4) {
            // 图片 / 链接
            const label = m[1];
            const url = m[2];
            return prefix + pat.wrap(parseInline(label, folder), label, url) + parseInline(rest, folder);
        }
        // 删除线 / 加粗 / 斜体：内容递归解析以支持嵌套
        inner = parseInline(m[1], folder);
        return prefix + pat.wrap(inner) + parseInline(rest, folder);
    }

    // 行内内容：先转义 HTML 再递归解析标记
    function renderInlineSafe(s, folder) {
        return parseInline(escapeHtml(s), folder);
    }

    /* ---------- 原始 HTML 行安全过滤（白名单） ----------
       正文需要能直接写 HTML/CSS（写示例、排版），但放行必须是有边界的：
       1) 危险标签整段丢弃（含内容）；
       2) 不在白名单的标签"拆壳"——丢掉标签本身、保留并继续清洗其内容；
       3) 所有 on* 事件属性与未知属性一律移除；
       4) href / src 等 URL 属性做协议校验（拦 javascript: 等），
          相对路径仍按"文章文件夹"解析，与非 HTML 写法保持一致。

       实现上借助 <template>：其内容处于惰性文档中，脚本不会执行、
       图片也不会发起请求，因此清洗过程本身没有副作用。 */
    // 整段丢弃的标签
    const HTML_DROP_TAGS = {
        script: 1, iframe: 1, object: 1, embed: 1, applet: 1, frame: 1, frameset: 1,
        form: 1, input: 1, button: 1, select: 1, option: 1, textarea: 1, label: 1,
        link: 1, meta: 1, base: 1, svg: 1, math: 1
    };
    // 允许保留的标签（其余一律拆壳保留文字）
    const HTML_ALLOWED_TAGS = {
        h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
        p: 1, div: 1, span: 1, br: 1, hr: 1, center: 1,
        a: 1, img: 1, picture: 1, source: 1,
        ul: 1, ol: 1, li: 1, dl: 1, dt: 1, dd: 1,
        table: 1, caption: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, th: 1, td: 1,
        col: 1, colgroup: 1,
        pre: 1, code: 1, kbd: 1, samp: 1, var: 1,
        blockquote: 1, figure: 1, figcaption: 1,
        strong: 1, b: 1, em: 1, i: 1, u: 1, s: 1, del: 1, ins: 1, mark: 1, small: 1,
        sub: 1, sup: 1, abbr: 1, cite: 1, q: 1, time: 1,
        details: 1, summary: 1,
        section: 1, article: 1, aside: 1, header: 1, footer: 1, nav: 1, main: 1,
        style: 1, audio: 1, video: 1, track: 1
    };
    // 允许保留的属性（URL 属性另见 HTML_URL_ATTRS，会额外做协议校验）
    const HTML_URL_ATTRS = { href: 1, src: 1, poster: 1 };
    const HTML_ALLOWED_ATTRS = {
        'class': 1, id: 1, style: 1, title: 1, lang: 1, dir: 1, hidden: 1,
        align: 1, width: 1, height: 1, border: 1, cellpadding: 1, cellspacing: 1,
        colspan: 1, rowspan: 1, start: 1, reversed: 1, datetime: 1, cite: 1,
        target: 1, rel: 1, alt: 1, loading: 1, decoding: 1, sizes: 1,
        controls: 1, loop: 1, muted: 1, autoplay: 1, preload: 1, playsinline: 1,
        media: 1, type: 1
    };
    // 这些标签内部的文字按原样保留，不做行内 Markdown 解析
    const HTML_RAW_TEXT_TAGS = ['pre', 'code', 'kbd', 'samp', 'style', 'script', 'textarea'];

    // 把 node 从父节点上摘掉，但把它的子节点留在原位置（"拆壳"）
    function unwrapNode(node) {
        const parent = node.parentNode;
        if (!parent) return;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
    }

    function cleanAttributes(el, folder) {
        const attrs = Array.prototype.slice.call(el.attributes);
        for (let i = 0; i < attrs.length; i++) {
            const name = attrs[i].name.toLowerCase();
            const value = attrs[i].value;
            if (name.indexOf('on') === 0) {          // on* 事件处理器：一律移除
                el.removeAttribute(attrs[i].name);
                continue;
            }
            if (HTML_URL_ATTRS[name]) {
                if (!isSafeUrl(value)) {
                    el.removeAttribute(attrs[i].name);
                    continue;
                }
                el.setAttribute(name, resolveAssetPath(folder, value.trim()));
                continue;
            }
            if (HTML_ALLOWED_ATTRS[name]) {
                // 内联样式里也藏得下脚本（老 IE 的 expression），顺手拦掉
                if (name === 'style' && /expression\s*\(|javascript:/i.test(value)) {
                    el.removeAttribute(attrs[i].name);
                }
                continue;
            }
            if (name.indexOf('data-') === 0 || name.indexOf('aria-') === 0) continue;
            el.removeAttribute(attrs[i].name);       // 其余未知属性：移除
        }
    }

    function cleanNode(root, folder) {
        const children = Array.prototype.slice.call(root.childNodes);
        for (let i = 0; i < children.length; i++) {
            const node = children[i];
            // 文本节点：解析行内 Markdown（`code`、**粗体**、图片、链接……）
            if (node.nodeType === 3) {
                const parent = node.parentNode;
                if (!parent) continue;
                const ptag = parent.tagName ? parent.tagName.toLowerCase() : '';
                if (HTML_RAW_TEXT_TAGS.indexOf(ptag) !== -1) continue;
                if (node.nodeValue.trim() === '') continue;
                const holder = document.createElement('span');
                holder.innerHTML = renderInlineSafe(node.nodeValue, folder);
                parent.replaceChild(holder, node);
                unwrapNode(holder);
                continue;
            }
            if (node.nodeType !== 1) continue;       // 注释 / 处理指令等：跳过
            const tag = node.tagName.toLowerCase();
            if (HTML_DROP_TAGS[tag]) {
                if (node.parentNode) node.parentNode.removeChild(node);
                continue;
            }
            if (!HTML_ALLOWED_TAGS[tag]) {
                cleanNode(node, folder);             // 先清洗内部，再拆壳保留内容
                unwrapNode(node);
                continue;
            }
            cleanAttributes(node, folder);
            cleanNode(node, folder);
        }
    }

    // 清洗一行原始 HTML，返回安全的 HTML 字符串
    function sanitizeHtml(rawHtml, folder) {
        const tpl = document.createElement('template');
        tpl.innerHTML = String(rawHtml == null ? '' : rawHtml);
        cleanNode(tpl.content, folder);
        const box = document.createElement('div');
        box.appendChild(tpl.content);
        return box.innerHTML;
    }

    // 代码块：根据语言添加 class（支持 html/css/js 等）
    function renderCodeBlock(lang, code) {
        const cls = lang ? ' class="language-' + lang.replace(/[^\w-]/g, '') + '"' : '';
        return '<pre><code' + cls + '>' + escapeHtml(code) + '</code></pre>';
    }
    /* ---------- 表格（GFM 风格） ---------- */
    // 按"反引号之外、且未被 \ 转义"的 | 切分单元格。
    // 这样 `a | b` 这类行内代码里的竖线不会把单元格切开
    function splitTableRow(line) {
        const s = String(line == null ? '' : line).trim();
        const cells = [];
        let buf = '';
        let inCode = false;
        for (let k = 0; k < s.length; k++) {
            const ch = s.charAt(k);
            if (ch === '\\' && s.charAt(k + 1) === '|') { buf += '|'; k++; continue; }
            if (ch === '`') { inCode = !inCode; buf += ch; continue; }
            if (ch === '|' && !inCode) { cells.push(buf); buf = ''; continue; }
            buf += ch;
        }
        cells.push(buf);
        // 首尾的管道符会产生空单元格，去掉它们（|a|b| → a|b）
        if (cells.length && cells[0].trim() === '') cells.shift();
        if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
        return cells;
    }
    // 分隔行判定：| --- | :---: | ---: |
    function isTableDelimiter(line) {
        if (line == null) return false;
        const t = String(line).trim();
        if (t === '' || t.indexOf('|') === -1) return false;
        if (!/^[\s|:-]+$/.test(t)) return false;   // 只允许空格、竖线、冒号、连字符
        const cells = splitTableRow(t);
        if (!cells.length) return false;
        return cells.every(function(c) { return /^:?-+:?$/.test(c.trim()); });
    }
    // 从分隔行解析对齐方式（:--- 左 / :---: 居中 / ---: 右 / --- 默认）
    function parseTableAligns(delimiterLine) {
        return splitTableRow(delimiterLine).map(function(c) {
            const v = c.trim();
            const left = v.charAt(0) === ':';
            const right = v.charAt(v.length - 1) === ':';
            if (left && right) return 'center';
            if (right) return 'right';
            if (left) return 'left';
            return '';
        });
    }
    // 渲染整张表；列数以表头为准，多出的忽略、缺少的补空
    function renderTable(header, aligns, rows, folder) {
        const cols = header.length;
        function cell(text, tag, idx) {
            const align = aligns[idx] || '';
            const style = align ? ' style="text-align:' + align + '"' : '';
            return '<' + tag + style + '>' + renderInlineSafe(String(text == null ? '' : text).trim(), folder) + '</' + tag + '>';
        }
        let out = '<div class="md-table-wrap"><table><thead><tr>';
        for (let c = 0; c < cols; c++) out += cell(header[c], 'th', c);
        out += '</tr></thead>';
        if (rows.length) {
            out += '<tbody>';
            for (let r = 0; r < rows.length; r++) {
                out += '<tr>';
                for (let c = 0; c < cols; c++) out += cell(rows[r][c], 'td', c);
                out += '</tr>';
            }
            out += '</tbody>';
        }
        out += '</table></div>';
        return out;
    }

    function renderMarkdown(md, folder) {
        if (!md) return '';
        const lines = md.split(/\r?\n/);
        let html = '';
        let inCode = false;
        let codeLang = '';
        let codeBuf = [];
        let listType = null; // 'ul' | 'ol'
        function closeList() {
            if (listType) { html += '</' + listType + '>'; listType = null; }
        }
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            // 代码块（支持语言标识）
            let cm = line.trim().match(/^```\s*([\w-]*)\s*$/);
            if (cm) {
                if (inCode) {
                    html += renderCodeBlock(codeLang, codeBuf.join('\n'));
                    codeBuf = [];
                    inCode = false;
                    codeLang = '';
                } else {
                    closeList();
                    inCode = true;
                    codeLang = cm[1] || '';
                }
                continue;
            }
            if (inCode) { codeBuf.push(line); continue; }

            const t = line.trim();
            if (t === '') { closeList(); html += '<p></p>'; continue; }

            // 表格（GFM）：当前行是表头，且下一行是分隔行 |---|---|
            if (t.indexOf('|') !== -1 && isTableDelimiter(lines[i + 1])) {
                const header = splitTableRow(t);
                const aligns = parseTableAligns(lines[i + 1]);
                const rows = [];
                let j = i + 2;
                for (; j < lines.length; j++) {
                    const rt = lines[j].trim();
                    // 表体到空行 / 非表格行 / 代码围栏为止
                    if (rt === '' || rt.indexOf('|') === -1 || /^```/.test(rt)) break;
                    rows.push(splitTableRow(rt));
                }
                if (header.length) {
                    closeList();
                    html += renderTable(header, aligns, rows, folder);
                    i = j - 1;   // 跳过已消费的表体行
                    continue;
                }
            }

            // 原始 HTML 行（如 <div>、<table> 等）：放行，但必须先过白名单清洗
            // （支持 html/css 语法示例，同时保证不会执行任何脚本）
            if (/^<.*>$/.test(t)) {
                closeList();
                html += sanitizeHtml(t, folder);
                continue;
            }

            // 标题
            let m = t.match(/^(#{1,6})\s+(.*)$/);
            if (m) {
                closeList();
                const lv = m[1].length;
                html += '<h' + lv + '>' + renderInlineSafe(m[2], folder) + '</h' + lv + '>';
                continue;
            }
            // 引用
            if (/^>\s?/.test(t)) {
                closeList();
                html += '<blockquote>' + renderInlineSafe(t.replace(/^>\s?/, ''), folder) + '</blockquote>';
                continue;
            }
            // 无序列表
            m = t.match(/^[-*]\s+(.*)$/);
            if (m) {
                if (listType !== 'ul') { closeList(); listType = 'ul'; html += '<ul>'; }
                html += '<li>' + renderInlineSafe(m[1], folder) + '</li>';
                continue;
            }
            // 有序列表
            m = t.match(/^\d+\.\s+(.*)$/);
            if (m) {
                if (listType !== 'ol') { closeList(); listType = 'ol'; html += '<ol>'; }
                html += '<li>' + renderInlineSafe(m[1], folder) + '</li>';
                continue;
            }
            // 分割线
            if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
                closeList();
                html += '<hr>';
                continue;
            }
            // 普通段落
            closeList();
            html += '<p>' + renderInlineSafe(t, folder) + '</p>';
        }
        closeList();
        if (inCode) html += renderCodeBlock(codeLang, codeBuf.join('\n'));
        return html;
    }

    /* ---------- 主题胶囊 ---------- */
    function themeCapsule(name) {
        const safe = escapeHtml((name || '').replace(/^#/, '').trim() || '未分类');
        return '<span class="blog-tag" data-theme="' + safe + '">' + safe + '</span>';
    }

    /* ---------- 数据加载（含 default 兜底） ---------- */
    async function fetchText(url) {
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) return null;
            return await res.text();
        } catch (e) { return null; }
    }

    async function loadArticle(folder) {
        const enc = encodeURIComponent(folder);
        const base = BLOG_BASE + enc + '/';
        const defTagRaw = await fetchText(DEFAULT_BASE + 'info/tag.txt');
        const defTag = defTagRaw ? defTagRaw.split(/\r?\n/).map(l => l.trim()) : [];
        const defPassage = await fetchText(DEFAULT_BASE + 'passage.md');

        const tagRaw = await fetchText(base + 'info/tag.txt');
        const passage = await fetchText(base + 'passage.md');

        const lines = tagRaw ? tagRaw.split(/\r?\n/).map(l => l.trim()) : [];
        const title = lines[0] || defTag[0] || '';
        const desc  = lines[1] || defTag[1] || '';
        const date  = lines[2] || defTag[2] || '';
        const theme = lines[3] || defTag[3] || '';
        // 第 5 行为文章 id；缺失时用文件夹名兜底生成（保证每篇都有稳定 id）
        let id = (lines[4] || defTag[4] || '').trim();
        if (!id) id = 'post_' + encodeURIComponent(folder).replace(/%[0-9A-F]{2}/g, '').toLowerCase();
        const body  = passage !== null ? passage : (defPassage !== null ? defPassage : '');

        // 封面不做存在性探测（探测需整张下载图片，浪费流量）：
        // 直接使用约定路径，由卡片 <img onerror> 降级到兜底封面
        let cover = base + 'info/cover.png';

        return {
            id: id,
            folder: folder,
            title: title.replace(/^#/, '').trim() || '未命名文章',
            desc: desc,
            date: date,
            theme: theme.replace(/^#/, '').trim(),
            cover: cover,
            body: body
        };
    }

    // 构建 idMap（id 去重：保留首个，后续追加后缀避免 hash 歧义）
    function buildIdMap(arts) {
        const map = {};
        const seen = {};
        arts.forEach(function(a) {
            let key = a.id;
            if (seen[key]) {
                let k2 = key, i2 = 2;
                while (seen[k2]) k2 = key + '_' + (i2++);
                a.id = k2;
                key = k2;
            }
            seen[key] = true;
            map[key] = a;
        });
        return map;
    }

    // 有界并发加载：同时最多 CONCURRENCY 个请求；每成功一篇回调 onArticle
    const CONCURRENCY = 4;
    // 仅拉取 list.txt，返回文章 id（文件夹名）列表；失败返回 null
    async function fetchFolderIds() {
        const listRaw = await fetchText(BLOG_BASE + 'list.txt');
        if (listRaw === null) return null;
        return listRaw.split(/\r?\n/).map(l => l.trim())
            .filter(l => l && RESERVED_FOLDERS.indexOf(l) === -1);
    }
    // 并发加载指定 id 列表的文章
    async function loadArticles(ids, onTotal, onArticle) {
        if (onTotal) onTotal(ids.length);
        const arts = [];
        let next = 0;
        async function worker() {
            while (next < ids.length) {
                const f = ids[next++];
                try {
                    const a = await loadArticle(f);
                    arts.push(a);
                    if (onArticle) onArticle(a, arts.length);
                } catch (e) { /* 跳过损坏条目 */ }
            }
        }
        const workers = [];
        const n = Math.min(CONCURRENCY, ids.length);
        for (let i = 0; i < n; i++) workers.push(worker());
        await Promise.all(workers);
        return arts;
    }

    /* ---------- 筛选 / 排序 ---------- */
    function getFiltered() {
        let list = articles.slice();
        // 主题筛选：精确匹配（优先级最高）
        if (filterTheme) {
            const kw = filterTheme.toLowerCase();
            list = list.filter(a => a.theme.toLowerCase() === kw);
        }
        // 名称筛选：模糊搜索
        if (filterName.trim()) {
            const kw = filterName.trim().toLowerCase();
            list = list.filter(a =>
                a.title.toLowerCase().includes(kw) ||
                a.folder.toLowerCase().includes(kw)
            );
        }
        // 排序
        if (sortKey === 'name') {
            list.sort((a, b) => {
                const r = a.title.localeCompare(b.title, 'zh-CN');
                return sortDir === 'desc' ? -r : r;
            });
        } else if (sortKey === 'time') {
            list.sort((a, b) => {
                const r = parseDate(a.date) - parseDate(b.date);
                return sortDir === 'desc' ? -r : r;
            });
        }
        return list;
    }
    function parseDate(s) {
        const m = String(s).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
        return 0;
    }

    /* ---------- 加载进度条（Win11 风格） ---------- */
    // 显示确定进度：bar 宽度百分比 + 文本；list.txt 未返回时用不确定态（流动动画）
    function setProgress(state, text, pct) {
        const wrap = document.getElementById('blogProgressWrap');
        const bar = document.getElementById('blogProgressBar');
        const txt = document.getElementById('blogLoadingText');
        if (!wrap || !bar) return;
        wrap.style.display = 'flex'; // CSS 默认 none，仅在需要时显示
        if (state === 'indeterminate') {
            wrap.classList.add('indeterminate');
            bar.style.width = '';
            if (txt) txt.textContent = text || '正在加载文章…';
        } else {
            wrap.classList.remove('indeterminate');
            const p = Math.max(0, Math.min(100, pct || 0));
            bar.style.width = p + '%';
            if (txt) txt.textContent = (text || '正在加载文章…') + '（' + Math.round(p) + '%）';
        }
    }
    function hideProgress() {
        const wrap = document.getElementById('blogProgressWrap');
        if (wrap) wrap.style.display = 'none';
        const bar = document.getElementById('blogProgressBar');
        if (bar) bar.style.width = '';
    }

    /* ---------- 渲染 ---------- */
    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function renderStat() {
        const stat = document.getElementById('blogStat');
        if (stat) stat.innerHTML = '本站已有 <strong>' + articles.length + '</strong> 篇文章';
    }

    function renderList() {
        // 列表渲染完成即视为加载结束：兜底隐藏进度条（防残留）
        hideProgress();
        const list = getFiltered();
        const total = list.length;
        const pages = Math.max(1, Math.ceil(total / PER_PAGE));
        if (page > pages) page = pages;

        const container = document.getElementById('blogCardList');
        container.innerHTML = '';

        if (total === 0) {
            container.appendChild(el('div', 'blog-empty', '没有符合条件的文章'));
        } else {
            const start = (page - 1) * PER_PAGE;
            const slice = list.slice(start, start + PER_PAGE);
            slice.forEach(a => container.appendChild(buildCard(a)));
        }
        renderPager(pages);
        renderStat();
    }

    // 加载中的轻量渲染：只显示已加载的文章（按 list.txt 顺序，不分页、不筛选），
    // 让用户尽快看到已就绪的部分；完成后由 renderList 全量接管。
    function renderLoading() {
        const container = document.getElementById('blogCardList');
        if (!container) return;
        // 仅当用户未启用筛选时增量显示（筛选会让部分结果忽隐忽现）；
        // 排序不再作为拦截条件——下方用当前排序渲染已加载的部分，
        // 这样加载完成前后顺序一致，不会突然跳一下
        if (filterName.trim() || filterTheme) return;
        container.innerHTML = '';
        if (articles.length === 0) {
            container.appendChild(el('div', 'blog-loading-text-only', '暂无文章'));
            return;
        }
        getFiltered().forEach(function(a) { container.appendChild(buildCard(a)); });
        hidePager(); // 加载期间隐藏分页器（总数未定）
        renderStat();
    }

    // 文章级 URL（收藏夹可直达；卡片用它做真实 href，支持新标签页打开）
    function postHash(id) {
        return '#blog/post/' + encodeURIComponent(id);
    }

    function buildCard(a) {
        // 用 <a> 而非 <article>：中键 / Ctrl+点击可"在新标签页打开"，
        // 普通左键仍由下方 click 处理器接管（preventDefault 后走 pushState）
        const card = el('a', 'blog-item');
        card.href = postHash(a.id);
        card.dataset.folder = a.folder;
        // 左侧封面（2/10）
        const cover = el('div', 'blog-item-cover');
        const img = document.createElement('img');
        img.src = a.cover;
        img.alt = a.title;
        img.loading = 'lazy';
        img.onerror = function() { this.src = DEFAULT_COVER; };
        cover.appendChild(img);
        // 右侧元数据（8/10）
        const meta = el('div', 'blog-item-meta');
        const titleBox = el('div', 'blog-item-title');
        const titleSpan = el('span', 'blog-item-title-text', a.title);
        const dateSpan = el('span', 'blog-item-date', a.date);
        titleBox.appendChild(titleSpan);
        titleBox.appendChild(dateSpan);
        const descBox = el('div', 'blog-item-desc');
        descBox.textContent = a.desc;
        const tagBox = el('div', 'blog-item-tag');
        tagBox.innerHTML = themeCapsule(a.theme);
        meta.appendChild(titleBox);
        meta.appendChild(descBox);
        meta.appendChild(tagBox);

        card.appendChild(cover);
        card.appendChild(meta);

        // 点击卡片进入文章；点击主题胶囊只触发主题筛选
        card.addEventListener('click', function(e) {
            if (e.target.closest('.blog-tag')) return;
            // 带修饰键 / 中键：交给浏览器原生行为（新标签页打开），不进站内阅读视图
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            openArticle(a);
        });
        const tagEl = tagBox.querySelector('.blog-tag');
        if (tagEl) {
            tagEl.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault(); // 胶囊在 <a> 内部：阻止卡片链接被触发
                setFilterByTheme(a.theme);
            });
        }
        return card;
    }

    // 页码选择器：结果不满一页（含无结果）时整块隐藏，不留空白间距。
    // pagerVisible 记录"列表态下分页器是否应当显示"，供 closeArticle 恢复显示时复用
    let pagerVisible = false;
    function hidePager() {
        const pager = document.getElementById('blogPager');
        if (!pager) return;
        pager.innerHTML = '';
        pager.style.display = 'none';
        pagerVisible = false;
    }
    function renderPager(pages) {
        const pager = document.getElementById('blogPager');
        if (!pager) return;
        if (pages <= 1) { hidePager(); return; }
        pagerVisible = true;
        pager.style.display = '';
        pager.innerHTML = '';
        const prev = el('button', 'blog-pg-btn', '‹');
        prev.disabled = (page === 1);
        prev.addEventListener('click', function() { page--; renderList(); });
        pager.appendChild(prev);
        for (let i = 1; i <= pages; i++) {
            const b = el('button', 'blog-pg-btn' + (i === page ? ' active' : ''), String(i));
            b.addEventListener('click', (function(n) { return function() { page = n; renderList(); }; })(i));
            pager.appendChild(b);
        }
        const next = el('button', 'blog-pg-btn', '›');
        next.disabled = (page === pages);
        next.addEventListener('click', function() { page++; renderList(); });
        pager.appendChild(next);
    }

    /* ---------- 阅读视图 ---------- */
    // 直达文章但数据未就绪时：先进入阅读视图骨架（进度条 + 文字），加载完成后填充
    function enterReadingPlaceholder(id) {
        readingArticle = null;
        document.getElementById('blogListView').style.display = 'none';
        document.getElementById('blogReadView').style.display = 'block';
        const filterPanel = document.getElementById('blogFilterPanel');
        if (filterPanel) filterPanel.style.display = 'none';
        const pager = document.getElementById('blogPager');
        if (pager) pager.style.display = 'none';
        // 标题与进度提示
        const titleEl = document.getElementById('blogReadTitle');
        if (titleEl) titleEl.textContent = '正在加载…';
        const metaEl = document.getElementById('blogReadMeta');
        if (metaEl) metaEl.innerHTML = '';
        const contentEl = document.getElementById('blogReadContent');
        if (contentEl) {
            contentEl.innerHTML =
                '<div class="blog-progress-wrap indeterminate">' +
                '<div class="blog-progress"><div class="blog-progress-bar"></div></div>' +
                '<span class="blog-loading-text">正在加载文章内容…（' + (id ? escapeHtml(id) : '') + '）</span>' +
                '</div>';
        }
        document.getElementById('blogBack').style.display = 'inline-flex';
        document.title = 'LongwaySite-加载中';
    }

    // 进入阅读视图。
    // mode：'push'（用户点卡片，新增历史记录）| 'none'（URL 已就位：直达链接、
    //       浏览器前进后退，不要动历史）。push 内部自带"hash 相同则不新增"的守卫，
    //       因此直达链接场景即使传 'push' 也不会多压一条记录。
    function openArticle(a, mode) {
        hideProgress(); // 进入阅读视图时隐藏列表进度条（防残留）
        readingArticle = a;
        document.getElementById('blogListView').style.display = 'none';
        document.getElementById('blogReadView').style.display = 'block';
        // 阅读文章时不显示筛选区
        const filterPanel = document.getElementById('blogFilterPanel');
        if (filterPanel) filterPanel.style.display = 'none';
        // 阅读文章时不显示分页器
        const pager = document.getElementById('blogPager');
        if (pager) pager.style.display = 'none';
        // 同步 URL：标记当前阅读的文章（收藏夹可直达、可分享）
        if (a && a.id) {
            const target = postHash(a.id);
            if (mode === 'none' || !window.AppNav) {
                if (history.replaceState && (location.hash || '') !== target) {
                    history.replaceState(null, '', target);
                }
            } else {
                window.AppNav.push(target);
            }
        }
        // 网页标题：LongwaySite-（文章元数据 Title）
        document.title = 'LongwaySite-' + (a.title || '未命名文章');
        document.getElementById('blogReadTitle').textContent = a.title;
        const meta = document.getElementById('blogReadMeta');
        meta.innerHTML = '';
        const dateEl = el('span', 'blog-read-date', a.date);
        const themeEl = document.createElement('span');
        themeEl.className = 'blog-tag';
        themeEl.textContent = a.theme || '未分类';
        themeEl.dataset.theme = a.theme;
        themeEl.addEventListener('click', function(e) {
            e.stopPropagation();
            setFilterByTheme(a.theme);
        });
        meta.appendChild(dateEl);
        meta.appendChild(themeEl);
        document.getElementById('blogReadContent').innerHTML = renderMarkdown(a.body, a.folder);
        document.getElementById('blogBack').style.display = 'inline-flex';
    }

    function closeArticle() {
        readingArticle = null;
        // 用户主动返回：放弃「加载完成后自动打开」的直达目标
        pendingPostId = null;
        document.getElementById('blogListView').style.display = '';
        document.getElementById('blogReadView').style.display = 'none';
        // 返回列表时恢复筛选区
        const filterPanel = document.getElementById('blogFilterPanel');
        if (filterPanel) filterPanel.style.display = '';
        // 返回列表时恢复分页器：只有"确实多于 1 页"时才显示，否则保持隐藏
        // （直接无条件 display = '' 会让不满一页的空白分页器又冒出来）
        const pager = document.getElementById('blogPager');
        if (pager) pager.style.display = pagerVisible ? '' : 'none';
        // 恢复网页标题
        document.title = 'LongwaySite';
        // 返回列表：若当前是文章级 hash，恢复为 #blog（替换而非新增，
        // 历史记录由「返回」按钮的 history.back() 负责，见 handleBackButton）
        if (currentPostId()) {
            if (window.AppNav) window.AppNav.replace('#blog');
            else if (history.replaceState) history.replaceState(null, '', '#blog');
        }
    }

    function setFilterByTheme(theme) {
        filterTheme = (theme || '').replace(/^#/, '').trim();
        filterName = '';
        page = 1;
        const nameInput = document.getElementById('blogSearchName');
        const themeInput = document.getElementById('blogSearchTheme');
        if (nameInput) nameInput.value = '';
        if (themeInput) themeInput.value = filterTheme;
        closeArticle();
        renderList();
        const panel = document.getElementById('blogFilterPanel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* ---------- 筛选 / 排序 交互 ---------- */
    function bindFilter() {
        // 筛选区 DOM 是 index.html 中的静态元素，重复绑定会导致
        // 输入防抖后多次 renderList（重复渲染），因此只绑定一次
        if (filterBound) return;
        filterBound = true;
        const nameInput = document.getElementById('blogSearchName');
        const themeInput = document.getElementById('blogSearchTheme');
        let timer = null;
        nameInput.addEventListener('input', function() {
            clearTimeout(timer);
            timer = setTimeout(function() {
                filterName = nameInput.value;
                page = 1;
                renderList();
            }, 200);
        });
        themeInput.addEventListener('input', function() {
            clearTimeout(timer);
            timer = setTimeout(function() {
                filterTheme = themeInput.value.trim();
                page = 1;
                renderList();
            }, 200);
        });

        const btnName = document.getElementById('blogSortName');
        const btnTime = document.getElementById('blogSortTime');
        const btnDir  = document.getElementById('blogSortDir');
        const btnReset = document.getElementById('blogSortReset');

        function refreshSortButtons() {
            // 始终有一个排序方式处于高亮（默认按名称），因此两个字段按钮
            // 永远恰好亮一个，方向按钮也永远可用
            btnName.classList.toggle('active', sortKey === 'name');
            btnTime.classList.toggle('active', sortKey === 'time');
            btnDir.disabled = false;
            btnDir.textContent = sortDir === 'asc' ? '升序 ↑' : '降序 ↓';
        }
        // 切换排序字段：已在当前字段上则什么都不做（高亮不消失、排序不变）；
        // 切到另一个字段时保留已经选好的升/降序
        function switchSortKey(key) {
            if (sortKey === key) return;
            sortKey = key;
            page = 1;
            refreshSortButtons();
            renderList();
        }
        btnName.addEventListener('click', function() { switchSortKey('name'); });
        btnTime.addEventListener('click', function() { switchSortKey('time'); });
        btnDir.addEventListener('click', function() {
            sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
            refreshSortButtons();
            renderList();
        });
        // 「取消」：清掉筛选条件，排序回到默认（按名称 + 升序，依旧高亮）
        btnReset.addEventListener('click', function() {
            filterName = '';
            filterTheme = '';
            sortKey = 'name';
            sortDir = 'asc';
            page = 1;
            nameInput.value = '';
            themeInput.value = '';
            refreshSortButtons();
            renderList();
        });
        refreshSortButtons();
    }

    /* ---------- 入口 ---------- */
    // 用缓存立即渲染数据（列表与统计就绪），并按需进入直达阅读视图
    function applyCache(cached) {
        articles = cached.articles;
        idMap = cached.idMap;
        totalCount = articles.length;
        // 无论是否直达，先确保列表数据与统计已就绪（阅读时列表隐藏但 DOM 已渲染，
        // 返回/切回列表时不会出现“空列表 + 0 篇文章”）
        const readView = document.getElementById('blogReadView');
        const inReading = readingArticle || (readView && readView.style.display === 'block');
        if (!inReading) {
            renderList();
            bindFilter();
        } else {
            // 在阅读/占位中：仅同步统计与列表 DOM（不打断阅读视图）
            renderStat();
            renderList(); // 后台渲染列表 DOM，返回即可见
        }
        if (pendingPostId && idMap[pendingPostId]) {
            // 直达且缓存命中 → 进入阅读视图（不显示进度条，URL 已就位不新增历史）
            openArticle(idMap[pendingPostId], 'none');
            return true;
        }
        return false;
    }

    // 主入口：先尝试缓存即时展示；若需检查更新则拉取 list 比对
    function ensureLoaded() {
        if (loaded) return;
        if (loading) return;
        loading = true;

        const cached = readCache();
        if (cached) applyCache(cached); // 立即展示缓存（无进度条）

        // 拉取最新 list.txt（轻量单请求），决定是否需要加载正文
        fetchFolderIds().then(function(ids) {
            if (ids === null) {
                // list 拉取失败
                loading = false;
                hideProgress();
                if (!cached) {
                    const container = document.getElementById('blogCardList');
                    if (container) {
                        container.innerHTML = '';
                        container.appendChild(el('div', 'blog-empty', '文章列表加载失败，请稍后重试。'));
                    }
                }
                loaded = true;
                return;
            }
            // 与缓存 id 集合比对（需求1/4）
            const cacheIds = new Set(cached ? cached.articles.map(function(a) { return a.id; }) : []);
            const hasNew = ids.some(function(id) { return !cacheIds.has(id); });

            if (cached && !hasNew) {
                // 全部已缓存且无新文章 → 不显示进度条，无需重新拉正文；
                // 同时剔除缓存中已被删除的文章（需求4），并回写
                const valid = new Set(ids);
                const kept = articles.filter(function(a) { return valid.has(a.id); });
                if (kept.length !== articles.length) {
                    articles = kept;
                    idMap = buildIdMap(articles);
                    totalCount = articles.length;
                    writeCache(articles);
                    renderStat();
                    // 若正阅读的文章已被删除 → 返回列表
                    if (readingArticle && !idMap[readingArticle.id]) {
                        closeArticle();
                    }
                    if (!readingArticle && document.getElementById('blogReadView').style.display !== 'block') {
                        renderList();
                    }
                }
                loading = false;
                loaded = true;
                hideProgress(); // 兜底：无新文章且全部已缓存 → 确保进度条隐藏
                return;
            }

            // 首次加载 或 存在新文章 → 显示进度条
            setProgress('indeterminate', cached ? '发现新文章，正在加载…' : '正在获取文章列表…');
            const toLoad = ids; // 加载全部（含可能更新的既有文章），保证一致性
            loadArticles(
                toLoad,
                function(total) {
                    totalCount = total;
                    if (total > 0) setProgress('determinate', '正在加载文章', 0);
                },
                function(a, loadedCount) {
                    const pct = totalCount > 0 ? Math.round(loadedCount / totalCount * 100) : 0;
                    setProgress('determinate', '正在加载文章', Math.min(99, pct));
                    if (!cached) {
                        articles.push(a);
                        renderLoading();
                    }
                }
            ).then(function(freshArts) {
                loading = false;
                loaded = true;
                articles = freshArts;
                idMap = buildIdMap(articles);
                totalCount = articles.length;
                writeCache(articles);
                hideProgress();
                // 数据就绪：先渲染列表与统计（即使正在阅读，列表 DOM 也后台就绪，返回不丢数据）
                // renderList() 内部已包含 renderStat()，bindFilter() 自带单次绑定守卫
                renderList();
                bindFilter();
                // 直达目标：用最新数据打开/填充
                if (pendingPostId) {
                    const target = idMap[pendingPostId] || articles.find(function(a) { return a.id === pendingPostId; });
                    pendingPostId = null;
                    if (target) {
                        if (readingArticle) {
                            if (target.body !== readingArticle.body || target.title !== readingArticle.title) openArticle(target, 'none');
                        } else {
                            openArticle(target, 'none');
                        }
                    } else {
                        showBlogList(); // 文章不存在：回列表
                    }
                }
            });
        });
    }

    /* ---------- hash 路由：支持 #blog/post/<id> ---------- */
    function currentPostId() {
        const m = (location.hash || '').match(/^#blog\/post\/(.+)$/);
        return m ? decodeURIComponent(m[1]) : null;
    }
    // 文章级 hash：进入 #blog/post/<id> 时，打开对应文章
    function openPostById(id) {
        if (!id) return;
        // 先同步尝试缓存命中（已缓存文章直达 → 立即阅读，修复刷新卡加载态）
        if (!loaded && !loading) {
            const c = readCache();
            if (c && c.idMap[id]) {
                pendingPostId = id;
                applyCache(c);       // 缓存命中 → openArticle（不显示进度条）
                ensureLoaded();      // 后台静默检查更新（不重复展示）
                return;
            }
        }
        if (!loaded && !loading) {
            // 无缓存命中：进入阅读占位并启动加载
            pendingPostId = id;
            enterReadingPlaceholder(id);
            ensureLoaded();
            return;
        }
        if (loaded) {
            const target = idMap[id] || articles.find(function(a) { return a.id === id; });
            if (target) {
                openArticle(target, 'none'); // 来自 hash 路由：URL 已就位
            } else {
                showBlogList(); // 文章不存在：回到列表
            }
            return;
        }
        // 仍在加载：进入占位并暂存，加载完成后填充
        pendingPostId = id;
        if (document.getElementById('blogReadView').style.display !== 'block') {
            enterReadingPlaceholder(id);
        }
    }
    // 确保博客标签激活并展示列表态（供返回/文章不存在时使用）
    function showBlogList() {
        // 切到博客标签（若未激活），并关闭阅读视图。
        // 用 'replace'：这里是状态修正，不应在历史里新增条目（后退/前进时尤其重要）
        if (window.AppShowTab) window.AppShowTab('blog', 'replace');
        closeArticle();
        renderList();
    }

    // 切回「我的博客」标签后调用：让面板内部状态与 URL 对齐。
    //
    // 场景（曾经的 bug）：在阅读视图时点了「空白页面」等其他标签，
    // 博客面板只是被隐藏，内部仍停在阅读态（readingArticle 还在、
    // #blogReadView 仍是 display:block）。再点回「我的博客」时，
    // 面板原样显出上次读的那篇文章，而 URL 已经被写成 #blog ——
    // 视图与 URL 打架，返回按钮也只能回退到上一步。
    // 这里保证：URL 是 #blog（列表）时，面板必须是列表态。
    function syncListIfHashIsList() {
        if (currentPostId()) return;   // 文章级 URL：由 handleHash 的流程负责，别插手
        const readView = document.getElementById('blogReadView');
        const reading = readingArticle || (readView && readView.style.display === 'block');
        if (!reading) return;          // 本来就是列表态，什么都不用做
        closeArticle();
        if (!loaded && !loading) ensureLoaded();
        else renderList();
    }

    // 统一处理 hash 变化（可能是用户点标签、也可能是浏览器前进/后退）
    function handleHash() {
        const postId = currentPostId();
        if (postId) {
            // 先打开文章（内部会处理缓存/占位/加载），再激活标签，
            // 避免 AppShowTab → 主脚本 ensureLoaded 抢跑错失缓存命中。
            // 此处 URL 已经就位，标签切换必须用 'none'，不能再写历史
            openPostById(postId);
            if (window.AppShowTab) window.AppShowTab('blog', 'none');
        } else if (location.hash === '#blog') {
            // 回到博客列表：若在阅读视图或占位态则退出
            const readView = document.getElementById('blogReadView');
            if (readingArticle || (readView && readView.style.display === 'block')) closeArticle();
            if (!loaded && !loading) ensureLoaded();
            else if (loaded) renderList();
        }
    }
    // popstate 与 hashchange 在"后退/前进"时会同时触发，这里合并成一次处理，
    // 避免同一跳转被处理两遍
    let hashHandleQueued = false;
    function scheduleHandleHash() {
        if (hashHandleQueued) return;
        hashHandleQueued = true;
        setTimeout(function() { hashHandleQueued = false; handleHash(); }, 0);
    }
    window.addEventListener('popstate', scheduleHandleHash);
    window.addEventListener('hashchange', scheduleHandleHash);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handleHash);
    } else {
        handleHash();
    }

    // 返回按钮：模块初始化时即绑定，保证加载期间进入阅读视图也可返回。
    // 优先走浏览器历史回退（这样"后退"才符合直觉）；直达链接等首屏场景
    // 没有可回退的站内历史时才退化为直接切回列表
    (function bindBackButton() {
        const backBtn = document.getElementById('blogBack');
        if (!backBtn) return;
        backBtn.addEventListener('click', function() {
            if (window.AppNav) {
                if (window.AppNav.canGoBack()) {
                    window.AppNav.goBack(); // 触发 popstate → scheduleHandleHash → closeArticle
                    return;
                }
                window.AppNav.replace('#blog');
            }
            closeArticle();
        });
    })();

    window.BlogModule = {
        ensureLoaded: ensureLoaded,
        openPostById: openPostById,
        // 标签切换后由 index.html 调用：URL 是 #blog 时必须回到列表态
        syncListIfHashIsList: syncListIfHashIsList,
        // 供外部强制重取（可选）
        refresh: function() {
            loaded = false;
            loading = false;
            ensureLoaded();
        }
    };
})();
