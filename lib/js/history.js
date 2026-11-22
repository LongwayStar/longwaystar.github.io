/* ============================================================
   历史版本页（#history）
   ------------------------------------------------------------
   两块内容：
     ① 卡片视图：Release / Beta 两张折叠卡
        - 大标题（RELEASE版本 / BETA版本）
        - 大版本号（BETA 不显示）用「余繁离形体」，右侧可切换大版本
        - 中版本列表（横线分隔），点击进入版本日志阅读视图
     ② 版本日志阅读视图：类似博客阅读视图
        - 返回按钮、Markdown 正文（复用 markdown.js + highlight.js）
        - 标题栏（左侧中版本号、右侧返回），无导航面板、无浮动按钮

   数据约定（lib/documents/archive/historylist/）：
     RELEASE/list.txt            每行一个大版本（如 1.0），新的在上
     RELEASE/<大版本>/list.txt   每行一个中版本（如 1.3 / 1.0），新的在上
     RELEASE/<大版本>/<中版本>/content.md
     BETA/content.md             整份 BETA 版本历史
   加载逻辑与博客页一致：先渲染 localStorage 缓存，再静默 fetch 更新。
   ============================================================ */
(function() {
    'use strict';

    var BASE = 'lib/documents/archive/historylist/';
    var CACHE_KEY = 'LongwaySiteHistoryV1';        // 清单缓存（大版本 / 中版本）
    var DOC_CACHE_KEY = 'LongwaySiteHistoryDocsV1';// content.md 原文缓存
    var DOC_CACHE_MAX = 24;                        // 缓存份数上限（超出按写入顺序丢弃）

    var loaded = false;
    var loading = null;
    var state = {
        release: { bigs: [], index: 0 },
        beta: { label: 'BETA 版本历史' }
    };
    var currentLog = null;      // { type, big, minor, title }
    var boundOnce = false;

    function $(id) { return document.getElementById(id); }

    function fetchText(url) {
        return fetch(url, { cache: 'no-store' }).then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text();
        });
    }

    function parseList(text) {
        return String(text == null ? '' : text).split(/\r?\n/)
            .map(function(s) { return s.trim(); })
            .filter(function(s) { return s !== ''; });
    }

    // 版本号按数字段比较（1.10 > 1.9），清单与显示都按「新的在上」排
    function versionKey(name) {
        return String(name).split('.').map(function(part) {
            var n = parseInt(part, 10);
            if (isNaN(n) || String(n) !== String(part)) return 'x' + part;
            return ('000000' + n).slice(-6);
        }).join('.');
    }
    function sortVersionsDesc(list) {
        return list.slice().sort(function(a, b) {
            var ka = versionKey(a);
            var kb = versionKey(b);
            return ka < kb ? 1 : (ka > kb ? -1 : 0);
        });
    }

    /* ---------- 缓存 ---------- */
    function readJSON(key) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function writeJSON(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 存储满了就放弃 */ }
    }
    function readDocs() {
        var d = readJSON(DOC_CACHE_KEY);
        return (d && typeof d === 'object') ? d : {};
    }
    function writeDoc(path, md) {
        var docs = readDocs();
        docs[path] = md;
        var keys = Object.keys(docs);
        if (keys.length > DOC_CACHE_MAX) {
            keys.slice(0, keys.length - DOC_CACHE_MAX).forEach(function(k) { delete docs[k]; });
        }
        writeJSON(DOC_CACHE_KEY, docs);
    }

    /* ---------- URL 安全（与 blog.js 同一套语义） ---------- */
    function isSafeUrl(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (s === '') return false;
        var compact = s.replace(/[\u0000-\u0020\u007F]+/g, '').toLowerCase();
        if (/^(javascript|vbscript|file|blob|about|chrome|jar|view-source)/.test(compact)) return false;
        if (compact.indexOf('data:') === 0 && compact.indexOf('data:image/') !== 0) return false;
        return true;
    }

    // 日志正文里的相对图片/链接 → 解析到该日志目录下
    function mdOptions(dir) {
        return {
            folder: dir,
            html: true,
            sanitize: true,
            highlightLib: window.LongwayHighlight || null,
            resolveUrl: function(raw) {
                if (!isSafeUrl(raw)) return null;
                var p = String(raw).trim();
                if (/^(https?:)?\/\//.test(p) || /^[a-z][a-z0-9+.\-]*:/i.test(p) || p.charAt(0) === '/') return p;
                return dir + p.replace(/^\.\//, '');
            }
        };
    }

    function renderMarkdown(md, dir) {
        var M = window.LongwayMarkdown;
        if (!M || typeof M.render !== 'function') {
            return '<p>' + String(md == null ? '' : md)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
        }
        return M.render(String(md == null ? '' : md), mdOptions(dir));
    }

    /* ============================================================
       ① 卡片视图
       ============================================================ */
    function buildReleaseCard() {
        var card = document.createElement('section');
        card.className = 'history-card';
        card.id = 'historyCardRelease';

        var title = document.createElement('h2');
        title.className = 'history-card-title';
        title.textContent = 'RELEASE版本';
        card.appendChild(title);

        var bigs = state.release.bigs;
        if (!bigs.length) {
            var empty = document.createElement('div');
            empty.className = 'history-empty';
            empty.textContent = '暂无 RELEASE 版本记录';
            card.appendChild(empty);
            return card;
        }

        var idx = state.release.index;
        if (!(idx >= 0 && idx < bigs.length)) idx = 0;
        state.release.index = idx;
        var big = bigs[idx];

        // 大版本号 + 右侧切换按钮：左「<」= 上一个大版本（版本号更小、更早），
        // 右「>」= 下一个大版本（版本号更大、更新）。列表新的在上，所以
        // 「上一个」往列表下方走（index + 1），「下一个」往列表上方走（index - 1）。
        var row = document.createElement('div');
        row.className = 'history-big-row';

        var bigName = document.createElement('span');
        bigName.className = 'history-big';
        bigName.textContent = big.name;
        row.appendChild(bigName);

        var sw = document.createElement('div');
        sw.className = 'history-big-switch';
        if (idx < bigs.length - 1) {
            sw.appendChild(switchButton('is-prev', '上一个大版本', function() {
                state.release.index = idx + 1;
                state.release.pageShift = 1;    // 往更早的版本翻，内容从下方滑入
                renderCards();
            }));
        }
        if (idx > 0) {
            sw.appendChild(switchButton('is-next', '下一个大版本', function() {
                state.release.index = idx - 1;
                state.release.pageShift = -1;   // 往更新的版本翻，内容从上方滑入
                renderCards();
            }));
        }
        row.appendChild(sw);
        card.appendChild(row);

        var divider = document.createElement('div');
        divider.className = 'history-divider';
        card.appendChild(divider);

        card.appendChild(minorList(big.minors, function(minor) {
            openLog('RELEASE', big.name, minor);
        }, '暂无中版本记录'));

        // 翻页动画：方向由切换按钮写入 state.release.pageShift，渲染一次就清掉
        if (state.release.pageShift) {
            card.classList.add('is-paging');
            card.style.setProperty('--page-shift', state.release.pageShift > 0 ? '16px' : '-16px');
        }
        return card;
    }

    function buildBetaCard() {
        var card = document.createElement('section');
        card.className = 'history-card';
        card.id = 'historyCardBeta';

        var title = document.createElement('h2');
        title.className = 'history-card-title';
        title.textContent = 'BETA版本';
        card.appendChild(title);

        // BETA 没有大版本号：标题下面直接是分割线 + 中版本列表
        var divider = document.createElement('div');
        divider.className = 'history-divider';
        card.appendChild(divider);

        var list = document.createElement('ul');
        list.className = 'history-minor-list';
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'history-minor';
        btn.textContent = 'BETA 版本历史';
        btn.addEventListener('click', function() { openLog('BETA', '', ''); });
        li.appendChild(btn);
        list.appendChild(li);
        card.appendChild(list);
        return card;
    }

    function switchButton(cls, label, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'history-switch ' + cls;
        b.title = label;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', onClick);
        return b;
    }

    function minorList(minors, onPick, emptyText) {
        if (!minors || !minors.length) {
            var d = document.createElement('div');
            d.className = 'history-empty';
            d.textContent = emptyText || '暂无版本记录';
            return d;
        }
        var ul = document.createElement('ul');
        ul.className = 'history-minor-list';
        minors.forEach(function(minor) {
            var li = document.createElement('li');
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'history-minor';
            btn.textContent = minor + '版本';
            btn.title = '查看 ' + minor + ' 版本更新内容';
            btn.addEventListener('click', function() { onPick(minor); });
            li.appendChild(btn);
            ul.appendChild(li);
        });
        return ul;
    }

    function renderCards() {
        var host = $('historyCards');
        if (!host) return;
        host.innerHTML = '';
        // 只有拿到任何一份清单才渲染卡片；首次无缓存又全失败时给提示
        var hasRelease = state.release.bigs.length > 0;
        if (!hasRelease && !state.beta) {
            host.innerHTML = '<div class="error">历史版本加载失败</div>';
            return;
        }
        // 顺序：RELEASE 在上、BETA 在下
        if (hasRelease) host.appendChild(buildReleaseCard());
        host.appendChild(buildBetaCard());
        state.release.pageShift = 0;
    }

    /* ============================================================
       ② 版本日志阅读视图
       ============================================================ */
    function logPaths(type, big, minor) {
        if (type === 'BETA') {
            return { path: BASE + 'BETA/content.md', dir: BASE + 'BETA/' };
        }
        var dir = BASE + 'RELEASE/' + encodeURIComponent(big) + '/' + encodeURIComponent(minor) + '/';
        return { path: dir + 'content.md', dir: dir };
    }

    function openLog(type, big, minor) {
        var paths = logPaths(type, big, minor);
        var titleText = (type === 'BETA') ? 'BETA 版本历史' : (minor + '版本');

        currentLog = { type: type, big: big, minor: minor, title: titleText, path: paths.path };

        var cards = $('historyCards');
        var read = $('historyRead');
        if (!read) return;
        if (cards) cards.hidden = true;
        read.hidden = false;
        var titleEl = $('historyReadTitle');
        if (titleEl) titleEl.textContent = titleText;

        var content = $('historyReadContent');
        if (!content) return;

        // 1) 缓存先显示（有缓存就不闪「加载中」）
        var docs = readDocs();
        if (docs[paths.path]) {
            content.innerHTML = renderMarkdown(docs[paths.path], paths.dir);
            bindCopy(content);
        } else {
            content.innerHTML = '<div class="loading">加载中...</div>';
        }
        // 2) 网络更新：内容变了或首次加载才重渲染
        fetchText(paths.path).then(function(md) {
            if (!currentLog || currentLog.path !== paths.path) return;
            var cached = docs[paths.path];
            if (cached === md) return;
            writeDoc(paths.path, md);
            content.innerHTML = renderMarkdown(md, paths.dir);
            bindCopy(content);
        }).catch(function(err) {
            if (!currentLog || currentLog.path !== paths.path) return;
            if (docs[paths.path]) return;   // 有缓存：网络失败不打扰阅读
            content.innerHTML = '<div class="error">日志加载失败: ' + String(err.message || err) + '</div>';
        });

        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function closeLog() {
        var read = $('historyRead');
        var cards = $('historyCards');
        if (read) read.hidden = true;
        if (cards) cards.hidden = false;
        currentLog = null;
        document.title = 'LongwaySite';
    }

    /* ---------- 代码块复制（与博客阅读视图同一套反馈，但绑定在这里） ---------- */
    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function(resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try {
                var ok = document.execCommand('copy');
                document.body.removeChild(ta);
                ok ? resolve() : reject(new Error('copy failed'));
            } catch (e) {
                document.body.removeChild(ta);
                reject(e);
            }
        });
    }

    function flashCopy(btn, ok) {
        btn.classList.remove('is-copied', 'is-failed');
        btn.classList.add(ok ? 'is-copied' : 'is-failed');
        btn.setAttribute('aria-label', ok ? '已复制' : '复制失败');
        clearTimeout(btn.__copyTimer);
        btn.__copyTimer = setTimeout(function() {
            btn.classList.remove('is-copied', 'is-failed');
            btn.setAttribute('aria-label', '复制代码');
        }, 1600);
    }

    function bindCopy(root) {
        if (!root || !root.querySelectorAll) return;
        Array.prototype.forEach.call(root.querySelectorAll('.md-code-copy'), function(btn) {
            if (btn.__bound) return;
            btn.__bound = true;
            btn.addEventListener('click', function() {
                var card = btn.closest ? btn.closest('.md-code') : null;
                var code = card ? card.querySelector('pre code') : null;
                copyText(code ? code.textContent : '').then(function() {
                    flashCopy(btn, true);
                }, function() {
                    flashCopy(btn, false);
                });
            });
        });
    }


    /* ---------- 事件绑定 ---------- */
    function bindOnce() {
        if (boundOnce) return;
        boundOnce = true;

        // 日志视图只有标题栏右侧的返回按钮，没有浮动按钮
        var back = $('historyBack');
        if (back) back.addEventListener('click', closeLog);
    }

    function ensureLoaded() {
        if (loaded) { return Promise.resolve(); }
        if (loading) return loading;
        bindOnce();

        // 1) 缓存先渲染
        var cached = readJSON(CACHE_KEY);
        var host = $('historyCards');
        if (cached && cached.release && cached.release.bigs && cached.release.bigs.length) {
            // 旧缓存可能是「旧的在上」的顺序：读入时统一按新的在上归一化
            var cachedBigs = cached.release.bigs.map(function(b) {
                return { name: b.name, minors: sortVersionsDesc(b.minors || []) };
            });
            cachedBigs.sort(function(a, b) {
                var ka = versionKey(a.name);
                var kb = versionKey(b.name);
                return ka < kb ? 1 : (ka > kb ? -1 : 0);
            });
            state.release.bigs = cachedBigs;
            var ci = cached.release.index;
            state.release.index = (ci >= 0 && ci < cachedBigs.length) ? ci : 0;
            renderCards();
        }

        // 2) 拉清单（RELEASE：大版本清单 → 每个大版本的中版本清单）
        //    列表文件约定「新的在上」，这里再排一次做兜底；默认显示第一个（最新）
        loading = fetchText(BASE + 'RELEASE/list.txt').then(function(bigText) {
            var names = sortVersionsDesc(parseList(bigText));
            return Promise.all(names.map(function(name) {
                return fetchText(BASE + 'RELEASE/' + encodeURIComponent(name) + '/list.txt')
                    .then(function(t) {
                        return { name: name, minors: sortVersionsDesc(parseList(t)) };
                    })
                    .catch(function() { return { name: name, minors: [] }; });
            }));
        }).then(function(bigs) {
            state.release.bigs = bigs;
            var prev = readJSON(CACHE_KEY);
            var oldIdx = prev && prev.release ? prev.release.index : 0;
            state.release.index = (oldIdx >= 0 && oldIdx < bigs.length) ? oldIdx : 0;
            loaded = true;
            writeJSON(CACHE_KEY, { release: { bigs: bigs, index: state.release.index } });
            renderCards();
            loading = null;
        }).catch(function(err) {
            if (!host) return;
            loading = null;
            var cached2 = readJSON(CACHE_KEY);
            if (cached2 && cached2.release && cached2.release.bigs && cached2.release.bigs.length) return;
            host.innerHTML = '<div class="error">历史版本加载失败: ' + String(err.message || err) + '</div>';
        });
        return loading;
    }

    function onTabShown(name) {
        if (name !== 'history' && currentLog) closeLog();
    }

    window.HistoryModule = {
        ensureLoaded: ensureLoaded,
        onTabShown: onTabShown
    };

    // 直达 #history（脚本在 inline 主脚本之后执行，此时面板可能已是 active）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            var panel = $('tab-history');
            if (panel && panel.classList.contains('active')) ensureLoaded();
        });
    } else {
        var panel0 = $('tab-history');
        if (panel0 && panel0.classList.contains('active')) ensureLoaded();
    }
})();
