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
    let filterName = '';      // 名称模糊搜索词
    let filterTheme = '';     // 主题精确筛选词
    let sortKey = null;       // 'name' | 'time' | null（null=默认顺序）
    let sortDir = 'asc';      // 'asc' | 'desc'
    let page = 1;             // 当前页
    const PER_PAGE = 10;      // 每页最多 10 条
    let loaded = false;
    let readingArticle = null; // 正在阅读的文章（null=列表态）

    /* ---------- 简易 Markdown / HTML 渲染 ---------- */
    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function renderInline(s) {
        return s
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/~~([^~]+)~~/g, '<del>$1</del>')
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }
    // 行内内容：先转义 HTML 再应用 markdown 标记，保证安全
    function renderInlineSafe(s) {
        return renderInline(escapeHtml(s));
    }
    // 代码块：根据语言添加 class（支持 html/css/js 等）
    function renderCodeBlock(lang, code) {
        const cls = lang ? ' class="language-' + lang.replace(/[^\w-]/g, '') + '"' : '';
        return '<pre><code' + cls + '>' + escapeHtml(code) + '</code></pre>';
    }
    function renderMarkdown(md) {
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
                html += '<h' + lv + '>' + renderInlineSafe(m[2]) + '</h' + lv + '>';
                continue;
            }
            // 引用
            if (/^>\s?/.test(t)) {
                closeList();
                html += '<blockquote>' + renderInlineSafe(t.replace(/^>\s?/, '')) + '</blockquote>';
                continue;
            }
            // 无序列表
            m = t.match(/^[-*]\s+(.*)$/);
            if (m) {
                if (listType !== 'ul') { closeList(); listType = 'ul'; html += '<ul>'; }
                html += '<li>' + renderInlineSafe(m[1]) + '</li>';
                continue;
            }
            // 有序列表
            m = t.match(/^\d+\.\s+(.*)$/);
            if (m) {
                if (listType !== 'ol') { closeList(); listType = 'ol'; html += '<ol>'; }
                html += '<li>' + renderInlineSafe(m[1]) + '</li>';
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
            html += '<p>' + renderInlineSafe(t) + '</p>';
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
        const body  = passage !== null ? passage : (defPassage !== null ? defPassage : '');

        let cover = base + 'info/cover.png';
        const coverCheck = await fetchText(base + 'info/cover.png');
        if (coverCheck === null) cover = defBase + 'info/cover.png';

        return {
            folder: folder,
            title: title.replace(/^#/, '').trim() || '未命名文章',
            desc: desc,
            date: date,
            theme: theme.replace(/^#/, '').trim(),
            cover: cover,
            body: body
        };
    }

    async function loadAll() {
        const listRaw = await fetchText(BLOG_BASE + 'list.txt');
        if (listRaw === null) return [];
        const folders = listRaw.split(/\r?\n/).map(l => l.trim()).filter(l => l && l !== '.Default');
        const arts = [];
        for (const f of folders) {
            try { arts.push(await loadArticle(f)); } catch (e) { /* 跳过损坏条目 */ }
        }
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
        document.getElementById('blogReadContent').innerHTML = renderMarkdown(a.body);
        document.getElementById('blogBack').style.display = 'inline-flex';
    }

    function closeArticle() {
        readingArticle = null;
        document.getElementById('blogListView').style.display = '';
        document.getElementById('blogReadView').style.display = 'none';
        // 返回列表时恢复筛选区
        const filterPanel = document.getElementById('blogFilterPanel');
        if (filterPanel) filterPanel.style.display = '';
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
        loaded = true;
        loadAll().then(function(arts) {
            articles = arts;
            renderList();
            bindFilter();
            document.getElementById('blogBack').addEventListener('click', closeArticle);
        });
    }

    // 刷新时若已在博客页（#blog），也自动加载一次
    function autoLoadIfOnBlog() {
        if (location.hash === '#blog') ensureLoaded();
    }
    window.addEventListener('hashchange', autoLoadIfOnBlog);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoLoadIfOnBlog);
    } else {
        autoLoadIfOnBlog();
    }

    window.BlogModule = { ensureLoaded: ensureLoaded };
})();
