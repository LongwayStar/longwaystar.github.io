/* ============================================================
   LongWeb 我的博客模块 (blog.js)
   依赖：无（原生 JS）
   数据：lib/words/blogs/
     - list.txt：文章文件夹清单（每行一个文件夹名，不含 .Default）
     - .Default/：默认数据（passage.md / info/cover.png / info/tag.txt）
     - <文章文件夹>/passage.md + info/{cover.png, tag.txt}
   tag.txt 四行：标题 / 描述 / 修改日期 / 主题
   文件缺失或格式不规范时，用 .Default 对应数据兜底
   ============================================================ */
(function() {
    'use strict';

    const BLOG_BASE = 'lib/words/blogs/';

    /* ---------- 状态 ---------- */
    let articles = [];        // 全部文章（含兜底后数据）
    let idMap = {};           // id → article 索引
    let filterName = '';      // 名称模糊搜索词
    let filterTheme = '';     // 主题精确筛选词
    let sortKey = null;       // 'name' | 'time' | null（null=默认顺序）
    let sortDir = 'asc';      // 'asc' | 'desc'
    let page = 1;             // 当前页
    const PER_PAGE = 10;      // 每页最多 10 条
    let loaded = false;
    let loading = false;      // 是否正在加载中（增量渲染期间为 true）
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

    // 递归解析行内标记，支持嵌套（如 ~~_斜体_~~）
    // text 已转义；在任意位置查找最早的特殊标记
    function parseInline(text, folder) {
        if (text === '') return '';
        const patterns = [
            { re: /`([^`]+)`/, wrap: (inner) => '<code>' + inner + '</code>' },
            { re: /~~([\s\S]+?)~~/, wrap: (inner) => '<del>' + inner + '</del>' },
            { re: /\*\*([\s\S]+?)\*\*/, wrap: (inner) => '<strong>' + inner + '</strong>' },
            { re: /!\[([^\]]*)\]\(([^)]*)\)/, wrap: (inner, alt, src) => {
                const url = resolveAssetPath(folder, src);
                return '<img src="' + url + '" alt="' + alt + '">';
            } },
            { re: /\[([^\]]+)\]\(([^)]*)\)/, wrap: (inner, label, href) => {
                const url = resolveAssetPath(folder, href);
                return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
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

    // 代码块：根据语言添加 class（支持 html/css/js 等）
    function renderCodeBlock(lang, code) {
        const cls = lang ? ' class="language-' + lang.replace(/[^\w-]/g, '') + '"' : '';
        return '<pre><code' + cls + '>' + escapeHtml(code) + '</code></pre>';
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

            // 原始 HTML 行（如 <div>、<table> 等）：直接放行，支持 html/css 语法
            if (/^<.*>$/.test(t)) {
                closeList();
                html += t;
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

    /* ---------- 数据加载（含 .Default 兜底） ---------- */
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
        const defBase = BLOG_BASE + '.Default/';
        const defTagRaw = await fetchText(defBase + 'info/tag.txt');
        const defTag = defTagRaw ? defTagRaw.split(/\r?\n/).map(l => l.trim()) : [];
        const defPassage = await fetchText(defBase + 'passage.md');

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

        let cover = base + 'info/cover.png';
        const coverCheck = await fetchText(base + 'info/cover.png');
        if (coverCheck === null) cover = defBase + 'info/cover.png';

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

    // 有界并发加载：同时最多 CONCURRENCY 个请求；每成功一篇回调 onArticle
    const CONCURRENCY = 4;
    async function loadAll(onTotal, onArticle) {
        const listRaw = await fetchText(BLOG_BASE + 'list.txt');
        if (listRaw === null) return { articles: [], idMap: {}, listError: true };
        const folders = listRaw.split(/\r?\n/).map(l => l.trim()).filter(l => l && l !== '.Default');
        if (onTotal) onTotal(folders.length);

        const arts = [];
        const idMap = {};
        let next = 0;
        async function worker() {
            while (next < folders.length) {
                const f = folders[next++];
                try {
                    const a = await loadArticle(f);
                    arts.push(a);
                    if (onArticle) onArticle(a, arts.length);
                } catch (e) { /* 跳过损坏条目 */ }
            }
        }
        const workers = [];
        const n = Math.min(CONCURRENCY, folders.length);
        for (let i = 0; i < n; i++) workers.push(worker());
        await Promise.all(workers);

        // 构建 idMap（id 去重：保留首个，后续追加后缀避免 hash 歧义）
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
            idMap[key] = a;
        });
        return { articles: arts, idMap: idMap, listError: false };
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
        wrap.style.display = '';
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
        // 仅当用户未启用筛选/排序时增量显示；否则等待完成态
        if (filterName.trim() || filterTheme || sortKey) return;
        container.innerHTML = '';
        if (articles.length === 0) {
            container.appendChild(el('div', 'blog-loading-text-only', '暂无文章'));
            return;
        }
        articles.forEach(function(a) { container.appendChild(buildCard(a)); });
        // 加载期间隐藏分页器（总数未定）
        const pager = document.getElementById('blogPager');
        if (pager) pager.innerHTML = '';
        renderStat();
    }

    function buildCard(a) {
        const card = el('article', 'blog-item');
        card.dataset.folder = a.folder;
        // 左侧封面（2/10）
        const cover = el('div', 'blog-item-cover');
        const img = document.createElement('img');
        img.src = a.cover;
        img.alt = a.title;
        img.loading = 'lazy';
        img.onerror = function() { this.src = BLOG_BASE + '.Default/info/cover.png'; };
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
            openArticle(a);
        });
        const tagEl = tagBox.querySelector('.blog-tag');
        if (tagEl) {
            tagEl.addEventListener('click', function(e) {
                e.stopPropagation();
                setFilterByTheme(a.theme);
            });
        }
        return card;
    }

    function renderPager(pages) {
        const pager = document.getElementById('blogPager');
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
    function openArticle(a) {
        readingArticle = a;
        document.getElementById('blogListView').style.display = 'none';
        document.getElementById('blogReadView').style.display = 'block';
        // 阅读文章时不显示筛选区
        const filterPanel = document.getElementById('blogFilterPanel');
        if (filterPanel) filterPanel.style.display = 'none';
        // 阅读文章时不显示分页器
        const pager = document.getElementById('blogPager');
        if (pager) pager.style.display = 'none';
        // 同步 URL：标记当前阅读的文章（收藏夹可直达）
        if (a && a.id && history.replaceState) {
            const target = '#blog/post/' + encodeURIComponent(a.id);
            if ((location.hash || '') !== target) history.replaceState(null, '', target);
        }
        // 网页标题：LongWeb-（文章元数据 Title）
        document.title = 'LongWeb-' + (a.title || '未命名文章');
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
        // 返回列表时恢复分页器
        const pager = document.getElementById('blogPager');
        if (pager) pager.style.display = '';
        // 恢复网页标题
        document.title = 'LongWeb';
        // 返回列表：若当前是文章级 hash，恢复为 #blog
        if (currentPostId() && history.replaceState) {
            history.replaceState(null, '', '#blog');
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
            btnName.classList.toggle('active', sortKey === 'name');
            btnTime.classList.toggle('active', sortKey === 'time');
            btnDir.disabled = (sortKey === null);
            btnDir.textContent = sortDir === 'asc' ? '升序 ↑' : '降序 ↓';
        }
        btnName.addEventListener('click', function() {
            sortKey = (sortKey === 'name' && sortDir === 'asc') ? null : 'name';
            if (sortKey === 'name') sortDir = 'asc';
            page = 1;
            refreshSortButtons();
            renderList();
        });
        btnTime.addEventListener('click', function() {
            sortKey = (sortKey === 'time' && sortDir === 'asc') ? null : 'time';
            if (sortKey === 'time') sortDir = 'asc';
            page = 1;
            refreshSortButtons();
            renderList();
        });
        btnDir.addEventListener('click', function() {
            sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
            refreshSortButtons();
            renderList();
        });
        btnReset.addEventListener('click', function() {
            filterName = '';
            filterTheme = '';
            sortKey = null;
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
    function ensureLoaded() {
        if (loaded) return;
        if (loading) return;
        loading = true;
        // 进入加载：先展示不确定态进度条（list.txt 尚未返回）
        setProgress('indeterminate', '正在获取文章列表…');
        loadAll(
            function(total) {
                // list.txt 已返回：切到确定进度
                totalCount = total;
                if (total > 0) {
                    setProgress('determinate', '正在加载文章', 0);
                } else {
                    setProgress('determinate', '加载中', 0);
                }
            },
            function(a, loadedCount) {
                // 每篇完成：累积进度 + 增量渲染已加载部分
                const pct = totalCount > 0 ? Math.round(loadedCount / totalCount * 100) : 0;
                setProgress('determinate', '正在加载文章', Math.min(99, pct));
                articles.push(a);
                renderLoading();
            }
        ).then(function(result) {
            loading = false;
            loaded = true;
            // articles 已在回调中累积，这里用结果覆盖（顺序以结果为准）
            articles = result.articles;
            idMap = result.idMap;
            if (result.listError) {
                hideProgress();
                const container = document.getElementById('blogCardList');
                if (container) {
                    container.innerHTML = '';
                    container.appendChild(el('div', 'blog-empty', '文章列表加载失败，请稍后重试。'));
                }
                return;
            }
            hideProgress();
            renderList();
            bindFilter();
            // 若存在 hash 直达的目标 id，加载完成后打开
            if (pendingPostId) {
                const target = idMap[pendingPostId] || articles.find(function(a) { return a.id === pendingPostId; });
                if (target) openArticle(target);
                pendingPostId = null;
            }
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
        if (!loaded && !loading) {
            pendingPostId = id;
            ensureLoaded();
            return;
        }
        if (loaded) {
            const target = idMap[id] || articles.find(function(a) { return a.id === id; });
            if (target) {
                openArticle(target);
            } else {
                // 文章不存在：回到列表
                showBlogList();
            }
            return;
        }
        // 仍在加载：暂存，加载完成后打开
        pendingPostId = id;
    }
    // 确保博客标签激活并展示列表态（供返回/不存在时使用）
    function showBlogList() {
        // 切到博客标签（若未激活），并关闭阅读视图
        if (window.AppShowTab) window.AppShowTab('blog');
        closeArticle();
        // hash 恢复为 #blog（若当前是文章级 hash）
        if (currentPostId() && history.replaceState) {
            history.replaceState(null, '', '#blog');
        }
        renderList();
    }

    function handleHash() {
        const postId = currentPostId();
        if (postId) {
            // 直达文章：确保博客标签激活并加载
            if (window.AppShowTab) window.AppShowTab('blog');
            openPostById(postId);
        } else if (location.hash === '#blog') {
            // 回到博客列表：若在阅读视图则退出
            if (readingArticle) closeArticle();
            if (!loaded && !loading) ensureLoaded();
            else if (loaded) renderList();
        }
    }
    window.addEventListener('hashchange', handleHash);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handleHash);
    } else {
        handleHash();
    }

    // 返回按钮：模块初始化时即绑定，保证加载期间进入阅读视图也可返回
    (function bindBackButton() {
        const backBtn = document.getElementById('blogBack');
        if (backBtn) backBtn.addEventListener('click', closeArticle);
    })();

    window.BlogModule = {
        ensureLoaded: ensureLoaded,
        openPostById: openPostById
    };
})();
