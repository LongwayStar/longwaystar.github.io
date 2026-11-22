/* ============================================================
   LongwayMarkdown（lib/js/markdown.js）
   —— 站点自用的 Markdown 渲染器：CommonMark 0.31 + GFM 扩展
   纯手写、零依赖、无构建；浏览器挂到 window.LongwayMarkdown，
   Node 下同时 module.exports（方便用脚本跑夹具测试）。

   相比旧的"逐行扫描 + 正则拼接"渲染器，这里是真正的两段式解析：
     ① 块级：把全文解析成块树（引用 / 列表 / 代码 / 表格 / HTML 块 …）
     ② 行内：对每个块的文本跑 CommonMark 的"定界符栈"算法
   旧渲染器的坑基本都出在"没有块结构"上：列表靠缩进猜、引用逐行拼、
   行内 HTML 逐行清洗把 <details> 补成闭合标签、强调用正则递归导致
   `**a*b**` 之类错配。块树 + 定界符栈从根上解决这些问题。

   支持的语法（按 CommonMark 0.31 与 GFM 规范）：
     标题（ATX / Setext）、段落、软/硬换行、引用（可嵌套、可惰性续行）、
     有序/无序列表（可嵌套、紧凑/松散、起始编号）、任务列表（GFM）、
     围栏代码块（信息串任意，含空格与中文）、缩进代码块、分割线、
     GFM 表格（含对齐与单元格内竖线转义）、原始 HTML 块（7 种启动条件）、
     行内代码（任意长度反引号）、强调/加粗（定界符栈 + 侧翼规则）、
     删除线（GFM）、链接与图片（行内式 / 引用式 / 简写引用式 / 自动链接）、
     反斜杠转义、HTML 实体、行内原始 HTML、裸 http(s) 链接自动识别。
     不支持：脚注、双反引号"包"代码（那是旧渲染器的误用写法，
     规范里行内代码用等长反引号串，见 parseInlines 的 code span 分支）。

   安全模型（与原站一致，可开关）：
     html:    false → 原始 HTML 全部转义，只显示文字（卡片渲染用它）
     sanitize:true  → 放行白名单标签；script/iframe 等整段丢弃；
                       on* 属性丢弃、URL 属性过协议校验、相对路径交给
                       调用方的 resolveUrl（blog.js 会拼成文章文件夹下的路径）
   ============================================================ */
(function (global, factory) {
    var api = factory(global);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (global) global.LongwayMarkdown = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (global) {
    'use strict';

    var VERSION = '1.0.0';

    /* ============================================================
       一、基础工具
       ============================================================ */

    var HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return HTML_ESCAPE[ch]; });
    }

    // 空白判定：CommonMark 的"空白"包括空格、制表符、换行与 Unicode 空白
    function isSpace(ch) {
        return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' ||
            (ch > '\u007f' && /\s/.test(ch));
    }
    // 标点/符号判定：CommonMark 强调规则里的"标点"= ASCII 标点 + Unicode 标点/符号
    var PUNCT_RE;
    try { PUNCT_RE = new RegExp('[\\p{P}\\p{S}]', 'u'); }
    catch (e) { PUNCT_RE = /[!-\/:-@\[-`{-~]/; }
    function isPunct(ch) {
        if (!ch) return false;
        return PUNCT_RE.test(ch);
    }
    function isBlankLine(line) {
        return /^[ \t]*$/.test(line);
    }
    // 行首缩进：返回 { col: 列数, idx: 第一个非空白字符的下标 }，Tab 按 4 列对齐
    function indentInfo(line) {
        var col = 0, idx = 0;
        while (idx < line.length) {
            var ch = line.charAt(idx);
            if (ch === ' ') { col += 1; idx += 1; continue; }
            if (ch === '\t') { col += 4 - (col % 4); idx += 1; continue; }
            break;
        }
        return { col: col, idx: idx };
    }
    // 去掉至多 n 列的缩进（Tab 记 4 列并按列对齐；只吃了一半的 Tab 用空格补回剩余部分）
    function stripIndent(line, n) {
        if (!n || n <= 0) return line;
        var col = 0, idx = 0;
        while (idx < line.length && col < n) {
            var ch = line.charAt(idx);
            if (ch === ' ') { col += 1; idx += 1; continue; }
            if (ch === '\t') {
                var w = 4 - (col % 4);
                if (col + w <= n) { col += w; idx += 1; continue; }
                var rest = col + w - n;
                return new Array(rest + 1).join(' ') + line.slice(idx + 1);
            }
            break;
        }
        return line.slice(idx);
    }
    // 一段空白串折成"列数"（Tab 记 4）
    function widthOf(str) {
        var col = 0;
        for (var i = 0; i < str.length; i++) {
            var ch = str.charAt(i);
            if (ch === '\t') col += 4 - (col % 4);
            else col += 1;
        }
        return col;
    }

    // ---------- HTML 实体（只备常用表；未收录的保持字面量） ----------
    var NAMED_ENTITIES = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
        copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
        mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
        ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb',
        times: '\u00d7', divide: '\u00f7', deg: '\u00b0', plusmn: '\u00b1',
        micro: '\u00b5', para: '\u00b6', middot: '\u00b7', bull: '\u2022',
        dagger: '\u2020', Dagger: '\u2021', permil: '\u2030', euro: '\u20ac',
        minus: '\u2212', asymp: '\u2248', ne: '\u2260', le: '\u2264', ge: '\u2265',
        larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193', harr: '\u2194',
        sup2: '\u00b2', sup3: '\u00b3', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
        thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003', zwj: '\u200d', zwnj: '\u200c'
    };
    var ENTITY_RE = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
    function decodeEntity(token) {
        // token 形如 "&amp;" / "&#123;" / "&#x1F;"
        if (token.charAt(1) === '#') {
            var num = token.charAt(2) === 'x' || token.charAt(2) === 'X'
                ? parseInt(token.slice(3, -1), 16)
                : parseInt(token.slice(2, -1), 10);
            if (!isFinite(num) || num <= 0 || num > 0x10ffff) return null;
            try { return String.fromCodePoint(num); } catch (e) { return null; }
        }
        var name = token.slice(1, -1);
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : null;
    }

    /* ============================================================
       二、原始 HTML 白名单清洗
       说明：这里刻意用"字符串逐标签清洗"而不是"塞进 DOM 再序列化"。
       DOM 序列化会把未闭合元素补齐，<details>…</details> 这种跨行结构
       会被第一行就补成闭合，后面的正文全掉到折叠块外面（旧渲染器踩过）。
       逐标签清洗只改写标签本身，结构原样保留。
       ============================================================ */

    // 整段丢弃的标签（连内容一起丢）
    var DROP_TAGS = {
        script: 1, iframe: 1, object: 1, embed: 1, applet: 1, frame: 1, frameset: 1,
        form: 1, input: 1, button: 1, select: 1, option: 1, textarea: 1, label: 1,
        link: 1, meta: 1, base: 1, svg: 1, math: 1
    };
    // 允许保留的标签（其余拆壳只留文字）
    var ALLOWED_TAGS = {
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
    // URL 属性（额外做协议校验 + 相对路径解析）
    var URL_ATTRS = { href: 1, src: 1, poster: 1 };
    // 其余允许的属性
    var ALLOWED_ATTRS = {
        'class': 1, id: 1, style: 1, title: 1, lang: 1, dir: 1, hidden: 1,
        align: 1, width: 1, height: 1, border: 1, cellpadding: 1, cellspacing: 1,
        colspan: 1, rowspan: 1, start: 1, reversed: 1, datetime: 1, cite: 1,
        target: 1, rel: 1, alt: 1, loading: 1, decoding: 1, sizes: 1,
        controls: 1, loop: 1, muted: 1, autoplay: 1, preload: 1, playsinline: 1,
        media: 1, type: 1
    };

    // 标签扫描：<name attrs> / </name> / <name ... />
    var TAG_RE = /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    var ATTR_RE = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

    // 默认 URL 策略：拦掉可执行脚本类协议（与 blog.js 的 isSafeUrl 同义）
    function defaultResolveUrl(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (s === '') return null;
        var compact = s.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
        if (/^(javascript|vbscript|file|blob|about|chrome|jar|view-source)/.test(compact)) return null;
        if (compact.indexOf('data:') === 0 && compact.indexOf('data:image/') !== 0) return null;
        return s;
    }

    function cleanAttrs(rawAttrs, ctx) {
        var out = '';
        ATTR_RE.lastIndex = 0;
        var m;
        while ((m = ATTR_RE.exec(rawAttrs)) !== null) {
            var name = m[1].toLowerCase();
            if (name.indexOf('on') === 0) continue;                  // on* 事件处理器：丢弃
            var isUrl = !!URL_ATTRS[name];
            if (!isUrl && !ALLOWED_ATTRS[name]) continue;            // 未知属性：丢弃
            var val = m[2] == null ? '' : m[2];
            if (/^["']/.test(val)) val = val.slice(1, -1);
            if (isUrl) {
                var resolved = ctx.resolveUrl(val);
                if (!resolved) continue;                             // 危险协议 / 空值：丢弃
                out += ' ' + name + '="' + escapeHtml(resolved) + '"';
                continue;
            }
            if (name === 'style' && /expression\s*\(|javascript:/i.test(val)) continue;
            out += ' ' + name + '="' + escapeHtml(val) + '"';
        }
        return out;
    }

    // 清洗一段原始 HTML（块级或行内都适用）。返回可安全插入的 HTML 字符串。
    function cleanHtml(raw, ctx) {
        var s = String(raw == null ? '' : raw);
        if (!ctx.html) return escapeHtml(s);
        if (!ctx.sanitize) return s;
        // 注释、PI、声明、CDATA 直接抹掉（保留它们没有意义，反倒容易被当成正文）
        s = s.replace(/<!--[\s\S]*?-->/g, '')
             .replace(/<\?[\s\S]*?\?>/g, '')
             .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
             .replace(/<![A-Za-z][^>]*>/g, '');
        var out = '';
        var pos = 0;
        var m;
        TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(s)) !== null) {
            out += s.slice(pos, m.index);          // 标签之间的文本：原样保留
            pos = m.index + m[0].length;
            var isClose = m[1] === '/';
            var name = m[2].toLowerCase();
            if (DROP_TAGS[name]) {
                if (!isClose) {
                    // 连内容一起丢：找到对应结束标签，没有就丢到末尾
                    var closeRe = new RegExp('</' + name + '\\s*>', 'i');
                    var cm = closeRe.exec(s.slice(pos));
                    pos = cm ? pos + cm.index + cm[0].length : s.length;
                    TAG_RE.lastIndex = pos;
                }
                continue;
            }
            if (!ALLOWED_TAGS[name]) continue;    // 非白名单标签：拆壳，只留文字
            if (isClose) {
                out += '</' + name + '>';
                continue;
            }
            out += '<' + name + cleanAttrs(m[3], ctx) + '>';
        }
        out += s.slice(pos);
        return out;
    }

    /* ============================================================
       三、行内解析（CommonMark 的定界符栈算法）
       节点类型：
         text   { v }                       普通文本（未被强调消费的部分）
         code   { v }                       行内代码
         html   { v }                       行内原始 HTML（渲染时清洗）
         br     {}                          硬换行
         em / strong / del { children }     强调 / 加粗 / 删除线
         link   { href, title, children }   链接
         image  { src, title, alt }         图片
       ============================================================ */

    // 行内 HTML 各形态（CommonMark 允许的 6 种）
    var HTML_INLINE_RES = [
        /^<!--[\s\S]*?-->/,                                     // 注释
        /^<\?[\s\S]*?\?>/,                                      // 处理指令
        /^<!\[CDATA\[[\s\S]*?\]\]>/,                            // CDATA
        /^<![A-Za-z][^>]*>/,                                    // 声明
        /^<\/[A-Za-z][A-Za-z0-9-]*\s*>/,                        // 结束标签
        /^<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^"'=<>`\s]+|'[^']*'|"[^"]*"))?)*\s*\/?>/  // 开始标签
    ];
    var AUTOLINK_URI_RE = /^<([A-Za-z][A-Za-z0-9+.\-]{1,31}:[^<>\u0000-\u0020]*)>/;
    var AUTOLINK_MAIL_RE = /^<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)*)>/;
    var BARE_URL_RE = /^https?:\/\/[^\s<>]*/;
    var ASCII_PUNCT_RE = /[!-\/:-@\[-`{-~]/;
    var PUNCT_ESCAPE_RE = /[!-\/:-@\[-`{-~]/;

    function normalizeLabel(s) {
        return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // 收集节点的纯文本（用于图片 alt 与引用标签）
    function plainText(nodes) {
        var out = '';
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.t === 'text' || n.t === 'code') out += n.v;
            else if (n.t === 'br') out += '\n';
            else if (n.children) out += plainText(n.children);
            else if (n.t === 'image') out += n.alt || '';
            else if (n.t === 'html') out += '';
        }
        return out;
    }

    // 跳过空格/制表符，允许至多一个换行（链接目标前后的空白规则）
    function skipWs(src, p) {
        var i = p, newline = 0;
        while (i < src.length) {
            var ch = src.charAt(i);
            if (ch === ' ' || ch === '\t') { i++; continue; }
            if (ch === '\n' && newline === 0) { newline++; i++; continue; }
            break;
        }
        return i;
    }

    // 解析行内链接尾部：(dest "title") —— p 指向 '('
    function parseInlineLinkTail(src, p) {
        var i = p + 1;
        var afterParen = skipWs(src, i);
        var href = '';
        var ch = src.charAt(afterParen);
        if (ch === '<') {
            i = afterParen + 1;
            while (i < src.length) {
                var c = src.charAt(i);
                if (c === '>') break;
                if (c === '\n' || c === '<') return null;
                if (c === '\\') { href += src.charAt(i + 1); i += 2; continue; }
                href += c; i++;
            }
            if (src.charAt(i) !== '>') return null;
            i++;
        } else {
            i = afterParen;
            var depth = 0;
            while (i < src.length) {
                var c2 = src.charAt(i);
                if (c2 === '\\') { href += src.charAt(i + 1); i += 2; continue; }
                if (c2 === '(') { depth++; href += c2; i++; continue; }
                if (c2 === ')') {
                    if (depth === 0) break;
                    depth--; href += c2; i++; continue;
                }
                if (c2 === ' ' || c2 === '\t' || c2 === '\n') break;
                if (c2 === '<') return null;
                href += c2; i++;
            }
            if (depth !== 0) return null;
        }
        var title = '';
        var j = skipWs(src, i);
        if (j > i) {
            var q = src.charAt(j);
            if (q === '"' || q === "'" || q === '(') {
                var close = q === '(' ? ')' : q;
                var k = j + 1;
                var buf = '';
                while (k < src.length) {
                    var cc = src.charAt(k);
                    if (cc === '\\') { buf += src.charAt(k + 1); k += 2; continue; }
                    if (cc === close) break;
                    if (q === '(' && cc === '(') return null;
                    buf += cc; k++;
                }
                if (src.charAt(k) !== close) return null;
                title = buf;
                i = skipWs(src, k + 1);
            }
        }
        if (src.charAt(i) !== ')') return null;
        return { href: href, title: title, end: i + 1 };
    }

    // 定界符匹配（CommonMark "process emphasis"）
    function processEmphasis(nodes, delims) {
        var guard = 0;
        var matched = true;
        while (matched && guard < 2000) {
            matched = false;
            guard++;
            for (var ci = 0; ci < delims.length && !matched; ci++) {
                var closer = delims[ci];
                if (!closer || closer.len <= 0 || !closer.canClose) continue;
                for (var oi = ci - 1; oi >= 0; oi--) {
                    var opener = delims[oi];
                    if (!opener || opener.len <= 0 || !opener.canOpen) continue;
                    if (opener.ch !== closer.ch) continue;
                    if (closer.ch === '~' && (opener.len < 2 || closer.len < 2)) continue;
                    // 规则三：两侧都能开/闭时，长度和为 3 的倍数就跳过
                    if ((opener.canClose || closer.canOpen) &&
                        ((opener.origLen + closer.origLen) % 3 === 0) &&
                        !(opener.origLen % 3 === 0 && closer.origLen % 3 === 0)) continue;
                    var use = closer.ch === '~' ? 2
                        : ((opener.len >= 2 && closer.len >= 2) ? 2 : 1);
                    matched = applyEmphasis(nodes, delims, opener, closer, use);
                    break;
                }
            }
        }
    }

    function applyEmphasis(nodes, delims, opener, closer, use) {
        var oIdx = nodes.indexOf(opener.node);
        var cIdx = nodes.indexOf(closer.node);
        if (oIdx < 0 || cIdx < 0 || cIdx <= oIdx) return false;
        var inner = nodes.slice(oIdx + 1, cIdx);
        var type = opener.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
        // 开定界符吃掉最右 use 个字符，闭定界符吃掉最左 use 个
        opener.node.v = opener.node.v.slice(0, opener.node.v.length - use);
        closer.node.v = closer.node.v.slice(use);
        opener.len -= use;
        closer.len -= use;
        nodes.splice(oIdx + 1, cIdx - oIdx - 1, { t: type, children: inner });
        // 两者之间的定界符已经进了强调内部，从栈上移除
        var di0 = delims.indexOf(opener), di1 = delims.indexOf(closer);
        if (di0 >= 0 && di1 > di0) delims.splice(di0 + 1, di1 - di0 - 1);
        // 用尽的定界符节点连着栈记录一起清掉
        if (opener.len <= 0) {
            var p0 = nodes.indexOf(opener.node);
            if (p0 >= 0) nodes.splice(p0, 1);
            var q0 = delims.indexOf(opener);
            if (q0 >= 0) delims.splice(q0, 1);
        }
        if (closer.len <= 0) {
            var p1 = nodes.indexOf(closer.node);
            if (p1 >= 0) nodes.splice(p1, 1);
            var q1 = delims.indexOf(closer);
            if (q1 >= 0) delims.splice(q1, 1);
        }
        return true;
    }

    function parseInlines(src, ctx) {
        var nodes = [];
        var delims = [];          // 定界符栈
        var brackets = [];        // 链接括号栈
        var i = 0;
        var len = src.length;

        function pushText(s) {
            if (!s) return;
            var last = nodes[nodes.length - 1];
            // 括号起始节点（'[' / '!['）自带 bracket 标记：绝不能被后面的文字并进去，
            // 否则关闭 ']' 时按节点下标截断会把标签文字一起切掉（踩过）
            if (last && last.t === 'text' && !last.delim && !last.bracket) last.v += s;
            else nodes.push({ t: 'text', v: s });
        }

        while (i < len) {
            var ch = src.charAt(i);

            /* ---- 反斜杠转义 / 硬换行 ---- */
            if (ch === '\\') {
                var next = src.charAt(i + 1);
                if (next === '\n') { nodes.push({ t: 'br' }); i += 2; continue; }
                if (next && PUNCT_ESCAPE_RE.test(next)) { pushText(next); i += 2; continue; }
                pushText('\\'); i += 1; continue;
            }

            /* ---- 行内代码：等长反引号串配对（规范写法） ---- */
            if (ch === '`') {
                var run = 1;
                while (src.charAt(i + run) === '`') run++;
                var j = i + run, found = -1;
                while (j < len) {
                    if (src.charAt(j) === '`') {
                        var r = 1;
                        while (src.charAt(j + r) === '`') r++;
                        if (r === run) { found = j; break; }
                        j += r;
                    } else {
                        j++;
                    }
                }
                if (found >= 0) {
                    var content = src.slice(i + run, found).replace(/\n/g, ' ');
                    // 前后各一个空格且不全为空格时，各剥掉一个
                    if (/^ .* $/.test(content) && /[^ ]/.test(content)) content = content.slice(1, -1);
                    nodes.push({ t: 'code', v: content });
                    i = found + run;
                    continue;
                }
                pushText(new Array(run + 1).join('`'));
                i += run;
                continue;
            }

            /* ---- 换行：两个以上行末空格 = 硬换行，否则软换行 ---- */
            if (ch === '\n') {
                var spaces = 0;
                var lastN = nodes[nodes.length - 1];
                if (lastN && lastN.t === 'text' && !lastN.delim) {
                    var sm = / +$/.exec(lastN.v);
                    if (sm) {
                        spaces = sm[0].length;
                        lastN.v = lastN.v.slice(0, lastN.v.length - spaces);
                        if (!lastN.v) nodes.pop();
                    }
                }
                if (spaces >= 2) nodes.push({ t: 'br' });
                else pushText('\n');
                i++;
                continue;
            }

            /* ---- HTML 实体 ---- */
            if (ch === '&') {
                var em = ENTITY_RE.exec(src.slice(i));
                if (em) {
                    var dec = decodeEntity(em[0]);
                    if (dec != null) { pushText(dec); i += em[0].length; continue; }
                }
                pushText('&'); i++; continue;
            }

            /* ---- 尖括号：自动链接 / 行内 HTML / 字面量 ---- */
            if (ch === '<') {
                var rest = src.slice(i);
                var am = AUTOLINK_URI_RE.exec(rest);
                if (am) {
                    nodes.push({ t: 'link', href: am[1], title: '', children: [{ t: 'text', v: am[1] }] });
                    i += am[0].length;
                    continue;
                }
                var mm = AUTOLINK_MAIL_RE.exec(rest);
                if (mm) {
                    nodes.push({ t: 'link', href: 'mailto:' + mm[1], title: '', children: [{ t: 'text', v: mm[1] }] });
                    i += mm[0].length;
                    continue;
                }
                var hm = null;
                for (var hr = 0; hr < HTML_INLINE_RES.length; hr++) {
                    hm = HTML_INLINE_RES[hr].exec(rest);
                    if (hm) break;
                }
                if (hm) {
                    nodes.push({ t: 'html', v: hm[0] });
                    i += hm[0].length;
                    continue;
                }
                pushText('<'); i++; continue;
            }

            /* ---- 裸 http(s) 链接（GFM 自动链接，保守实现） ---- */
            if ((ch === 'h' || ch === 'H') && /^https?:\/\//i.test(src.slice(i))) {
                var prevCh = i === 0 ? '\n' : src.charAt(i - 1);
                if (isSpace(prevCh) || isPunct(prevCh)) {
                    var bm = BARE_URL_RE.exec(src.slice(i));
                    if (bm) {
                        var url = bm[0];
                        // 去掉结尾的标点与不配对的右括号
                        var trimmed = url.replace(/[.,;:!?'"]+$/, '');
                        if (trimmed.charAt(trimmed.length - 1) === ')' && (trimmed.match(/\(/g) || []).length < (trimmed.match(/\)/g) || []).length) {
                            trimmed = trimmed.slice(0, -1);
                        }
                        nodes.push({ t: 'link', href: trimmed, title: '', children: [{ t: 'text', v: trimmed }] });
                        i += trimmed.length;
                        continue;
                    }
                }
            }

            /* ---- 图片 / 链接括号 ---- */
            if (ch === '!') {
                if (src.charAt(i + 1) === '[') {
                    // 注意：'![' 必须自成节点。若用 pushText，会并进前一个文本节点，
                    // 之后按 br.index 截断时会把前面的正文一起切掉（踩过）
                    nodes.push({ t: 'text', v: '![', bracket: true });
                    brackets.push({ index: nodes.length - 1, image: true, active: true, delimCount: delims.length });
                    i += 2;
                    continue;
                }
                pushText('!'); i++; continue;
            }
            if (ch === '[') {
                nodes.push({ t: 'text', v: '[', bracket: true });
                brackets.push({ index: nodes.length - 1, image: false, active: true, delimCount: delims.length });
                i++;
                continue;
            }
            if (ch === ']') {
                var br = brackets.length ? brackets.pop() : null;
                if (!br) { pushText(']'); i++; continue; }
                if (!br.active) { pushText(']'); i++; continue; }

                var result = null;
                // ① 行内式 [text](dest "title")
                if (src.charAt(i + 1) === '(') {
                    var tail = parseInlineLinkTail(src, i + 1);
                    if (tail) result = { href: tail.href, title: tail.title, end: tail.end };
                }
                // ② 引用式 [text][label] / [text][] / [text]
                if (!result) {
                    var label = null, end = i + 1;
                    if (src.charAt(i + 1) === '[') {
                        var close = src.indexOf(']', i + 2);
                        if (close >= 0) {
                            var innerLabel = src.slice(i + 2, close);
                            if (innerLabel.indexOf('[') < 0 && innerLabel.indexOf(']') < 0) {
                                end = close + 1;
                                label = innerLabel.replace(/\s+/g, ' ').trim() || plainText(nodes.slice(br.index + 1));
                            }
                        }
                    } else {
                        label = plainText(nodes.slice(br.index + 1));
                    }
                    if (label != null) {
                        var def = ctx.refs[normalizeLabel(label)];
                        if (def) result = { href: def.href, title: def.title || '', end: end };
                    }
                }
                if (!result) { pushText(']'); i++; continue; }

                // 链接/图片内部先处理强调（强调不能跨过链接边界配对）；
                // '![' 与 '[' 都是单独节点，截断点就是 br.index 本身
                var startIdx = br.index;
                var children = nodes.slice(br.index + 1);
                var innerDelims = delims.splice(br.delimCount);
                processEmphasis(children, innerDelims);
                var linkNode = br.image
                    ? { t: 'image', src: result.href, title: result.title, alt: plainText(children) }
                    : { t: 'link', href: result.href, title: result.title, children: children };
                nodes.length = startIdx;
                nodes.push(linkNode);
                // 链接里不能再嵌链接：把更早的链接括号作废
                if (!br.image) {
                    for (var bk = 0; bk < brackets.length; bk++) if (!brackets[bk].image) brackets[bk].active = false;
                }
                i = result.end;
                continue;
            }

            /* ---- 强调 / 加粗 / 删除线的定界符 ---- */
            if (ch === '*' || ch === '_' || ch === '~') {
                var run2 = 1;
                while (src.charAt(i + run2) === ch) run2++;
                var before = i === 0 ? '\n' : src.charAt(i - 1);
                var after = i + run2 >= len ? '\n' : src.charAt(i + run2);
                var beforeWS = isSpace(before), afterWS = isSpace(after);
                var beforeP = isPunct(before), afterP = isPunct(after);
                var leftFlanking = !afterWS && (!afterP || beforeWS || beforeP);
                var rightFlanking = !beforeWS && (!beforeP || afterWS || afterP);
                var canOpen, canClose;
                if (ch === '_') {
                    canOpen = leftFlanking && (!rightFlanking || beforeP);
                    canClose = rightFlanking && (!leftFlanking || afterP);
                } else {
                    canOpen = leftFlanking;
                    canClose = rightFlanking;
                }
                var chars = new Array(run2 + 1).join(ch);
                if (ch === '~' && run2 < 2) { pushText(chars); i += run2; continue; }   // 单个 ~ 不是删除线
                var dNode = { t: 'text', v: chars, delim: true };
                nodes.push(dNode);
                delims.push({
                    ch: ch, node: dNode, len: run2, origLen: run2,
                    canOpen: canOpen, canClose: canClose
                });
                i += run2;
                continue;
            }

            /* ---- 普通字符 ---- */
            pushText(ch);
            i++;
        }

        processEmphasis(nodes, delims);
        // 收尾：仍带 delim 标记的文本节点还原成普通节点
        for (var n = 0; n < nodes.length; n++) {
            if (nodes[n].delim) delete nodes[n].delim;
        }
        return nodes;
    }

    /* ============================================================
       四、块级解析
       ============================================================ */

    // CommonMark 第 6 类 HTML 块的起始标签表
    var BLOCK_TAGS = ('address article aside base basefont blockquote body caption center col colgroup ' +
        'dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset ' +
        'h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav ' +
        'noframes ol optgroup option p param section source summary table tbody td tfoot th thead ' +
        'title tr track ul').split(' ');
    var BLOCK_TAGS_OBJ = {};
    for (var bt = 0; bt < BLOCK_TAGS.length; bt++) BLOCK_TAGS_OBJ[BLOCK_TAGS[bt]] = 1;

    var ATX_RE = /^(#{1,6})(?:[ \t]+(.*))?$/;
    var SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;
    var FENCE_RE = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/;
    var HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
    var REF_DEF_RE = /^ {0,3}\[([^\]]+)\]:[ \t]*(<[^>\n]*>|[^\s]+)[ \t]*(.*)$/;

    // 列表项标记：无序 - + * / 有序 1. 1)
    function listMarker(line, info) {
        if (info.col > 3) return null;
        var rest = line.slice(info.idx);
        var m = /^([-+*])([ \t]+|$)/.exec(rest);
        if (m) {
            return {
                ordered: false, marker: m[1], markerLen: 1,
                gap: m[2], rest: rest.slice(1 + m[2].length),
                start: 1
            };
        }
        m = /^(\d{1,9})([.)])([ \t]+|$)/.exec(rest);
        if (m) {
            return {
                ordered: true, marker: m[1] + m[2], markerLen: m[1].length + 1,
                gap: m[3], rest: rest.slice(m[0].length),
                start: parseInt(m[1], 10), delim: m[2]
            };
        }
        return null;
    }

    // HTML 块启动条件（kind 1~7）
    function htmlBlockKind(line, info) {
        if (info.col > 3) return null;
        var t = line.slice(info.idx);
        var m;
        if (/^<(script|pre|style|textarea)(?=[\s>\/]|$)/i.test(t)) {
            return { kind: 1, endRe: /<\/(script|pre|style|textarea)\s*>/i };
        }
        if (/^<!--/.test(t)) return { kind: 2, endRe: /-->/ };
        if (/^<\?/.test(t)) return { kind: 3, endRe: /\?>/ };
        if (/^<![A-Za-z]/.test(t)) return { kind: 4, endRe: />/ };
        if (/^<!\[CDATA\[/.test(t)) return { kind: 5, endRe: /\]\]>/ };
        m = /^<\/?([A-Za-z][A-Za-z0-9]*)(?=[\s>\/]|$)/.exec(t);
        if (m && BLOCK_TAGS_OBJ[m[1].toLowerCase()]) return { kind: 6 };
        if (/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>\s*$/.test(t)) return { kind: 7 };
        return null;
    }

    // 某个块是否算"新块起始"（用于段落中断与惰性续行判定）
    function startsBlock(line) {
        var info = indentInfo(line);
        if (info.col > 3) return false;
        var t = line.slice(info.idx);
        if (FENCE_RE.test(line)) return true;
        if (/^#{1,6}(?:[ \t]|$)/.test(t)) return true;
        if (t.charAt(0) === '>') return true;
        if (HR_RE.test(line)) return true;
        var hb = htmlBlockKind(line, info);
        if (hb && hb.kind <= 6) return true;
        var mk = listMarker(line, info);
        if (mk && mk.rest.trim() !== '') {
            if (!mk.ordered) return true;
            if (mk.start === 1) return true;
        }
        return false;
    }

    // 表格分隔行：|---|:---:|---:|；单元格只允许 空格 / - / :
    function isDelimiterRow(line) {
        var t = String(line == null ? '' : line).trim();
        if (t === '' || t.indexOf('|') === -1) return false;
        if (!/^[\s|:-]+$/.test(t)) return false;
        var cells = splitTableRow(t);
        if (!cells.length) return false;
        for (var i = 0; i < cells.length; i++) {
            if (!/^:?-+:?$/.test(cells[i].trim())) return false;
        }
        return true;
    }
    // 按"反引号之外、且未被 \ 转义"的 | 切分单元格（沿用原站行为：
    // 行内代码里的竖线不切分，\| 显示为字面竖线）
    function splitTableRow(line) {
        var s = String(line == null ? '' : line).trim();
        var cells = [], buf = '', inCode = false;
        for (var k = 0; k < s.length; k++) {
            var ch = s.charAt(k);
            if (ch === '\\' && s.charAt(k + 1) === '|') { buf += '|'; k++; continue; }
            if (ch === '`') { inCode = !inCode; buf += ch; continue; }
            if (ch === '|' && !inCode) { cells.push(buf); buf = ''; continue; }
            buf += ch;
        }
        cells.push(buf);
        if (cells.length && cells[0].trim() === '') cells.shift();
        if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
        return cells;
    }
    function parseAligns(delimiterLine) {
        return splitTableRow(delimiterLine).map(function (c) {
            var v = c.trim();
            var left = v.charAt(0) === ':';
            var right = v.charAt(v.length - 1) === ':';
            if (left && right) return 'center';
            if (right) return 'right';
            if (left) return 'left';
            return '';
        });
    }

    // 引用定义：[label]: dest "title"
    function parseRefDef(line) {
        var m = REF_DEF_RE.exec(line);
        if (!m) return null;
        var href = m[2];
        if (href.charAt(0) === '<') href = href.slice(1, -1);
        var titleRaw = m[3].trim();
        var title = '';
        if (titleRaw !== '') {
            var tm = /^(?:"([^"]*)"|'([^']*)'|\(([^()]*)\))$/.exec(titleRaw);
            if (!tm) return null;
            title = tm[1] != null ? tm[1] : (tm[2] != null ? tm[2] : tm[3]);
        }
        return { label: m[1], href: href, title: title };
    }

    function parseBlocks(lines, ctx, depth) {
        var blocks = [];
        var n = lines.length;
        var i = 0;
        if (depth > 100) return [{ t: 'paragraph', raw: lines.join('\n') }];

        while (i < n) {
            var line = lines[i];
            if (isBlankLine(line)) { i++; continue; }
            var info = indentInfo(line);

            /* ---- 引用（含惰性续行） ---- */
            if (info.col <= 3 && line.charAt(info.idx) === '>') {
                var inner = [];
                var j = i;
                var prevContent = null;
                while (j < n) {
                    var rawQ = lines[j];
                    if (isBlankLine(rawQ)) break;
                    var qi = indentInfo(rawQ);
                    if (qi.col <= 3 && rawQ.charAt(qi.idx) === '>') {
                        var restQ = rawQ.slice(qi.idx + 1);
                        if (restQ.charAt(0) === ' ') restQ = restQ.slice(1);
                        else if (restQ.charAt(0) === '\t') restQ = '   ' + restQ.slice(1);
                        inner.push(restQ);
                        prevContent = restQ;
                        j++;
                        continue;
                    }
                    // 惰性续行：没有 > 前缀、但上一行还是段落内容
                    if (prevContent !== null && !isBlankLine(rawQ) && !startsBlock(rawQ)) {
                        inner.push(rawQ.replace(/^[ \t]+/, ''));
                        j++;
                        continue;
                    }
                    break;
                }
                blocks.push({ t: 'blockquote', children: parseBlocks(inner, ctx, depth + 1) });
                i = j;
                continue;
            }

            /* ---- ATX 标题 ---- */
            if (info.col <= 3) {
                var atx = ATX_RE.exec(line.slice(info.idx));
                if (atx) {
                    var headText = atx[2] == null ? '' : atx[2];
                    headText = headText.replace(/[ \t]+#+[ \t]*$/, '').trim();
                    blocks.push({ t: 'heading', level: atx[1].length, raw: headText });
                    i++;
                    continue;
                }
            }

            /* ---- 围栏代码块 ---- */
            var fm = FENCE_RE.exec(line);
            if (fm) {
                var fenceChar = fm[2].charAt(0);
                var fenceLen = fm[2].length;
                var fenceIndent = fm[1].length;
                var fenceInfo = fm[3].replace(/^[ \t]+/, '').trim();
                // 反引号围栏的信息串里不允许出现反引号（否则不是围栏）
                if (!(fenceChar === '`' && fenceInfo.indexOf('`') >= 0)) {
                    var closeRe = new RegExp('^ {0,3}' + (fenceChar === '`' ? '`' : '~') + '{' + fenceLen + ',}[ \\t]*$');
                    var buf = [];
                    var jf = i + 1;
                    while (jf < n && !closeRe.test(lines[jf])) {
                        buf.push(stripIndent(lines[jf], fenceIndent));
                        jf++;
                    }
                    blocks.push({ t: 'code', info: fenceInfo, text: buf.join('\n') });
                    i = (jf < n) ? jf + 1 : jf;
                    continue;
                }
            }

            /* ---- 原始 HTML 块 ---- */
            var hb = htmlBlockKind(line, info);
            if (hb) {
                var jh = i;
                if (hb.kind >= 6) {
                    while (jh < n && !isBlankLine(lines[jh])) jh++;
                } else {
                    while (jh < n) {
                        var cur = lines[jh];
                        jh++;
                        if (hb.endRe.test(cur)) break;
                    }
                }
                blocks.push({ t: 'html', raw: lines.slice(i, jh).join('\n') });
                i = jh;
                continue;
            }

            /* ---- 分割线（优先级高于列表：- - - 是分割线） ---- */
            if (HR_RE.test(line)) {
                blocks.push({ t: 'hr' });
                i++;
                continue;
            }

            /* ---- 列表 ---- */
            var lm = listMarker(line, info);
            if (lm) {
                var listRes = parseList(lines, i, ctx, depth);
                blocks.push(listRes.node);
                i = listRes.next;
                continue;
            }

            /* ---- GFM 表格（当前行是表头、下一行是分隔行） ---- */
            if (line.indexOf('|') !== -1 && i + 1 < n && isDelimiterRow(lines[i + 1])) {
                var headerCells = splitTableRow(line);
                var aligns = parseAligns(lines[i + 1]);
                var rows = [];
                var jt = i + 2;
                while (jt < n) {
                    var rt = lines[jt];
                    if (isBlankLine(rt) || rt.indexOf('|') === -1) break;
                    if (FENCE_RE.test(rt) || HR_RE.test(rt)) break;
                    rows.push(splitTableRow(rt));
                    jt++;
                }
                blocks.push({ t: 'table', aligns: aligns, header: headerCells, rows: rows });
                i = jt;
                continue;
            }

            /* ---- 引用定义 ---- */
            var refDef = parseRefDef(line);
            if (refDef) {
                ctx.refs[normalizeLabel(refDef.label)] = { href: refDef.href, title: refDef.title };
                i++;
                continue;
            }

            /* ---- 缩进代码块 ---- */
            if (info.col >= 4) {
                var codeBuf = [];
                var jc = i;
                while (jc < n) {
                    var lc = lines[jc];
                    if (isBlankLine(lc)) { codeBuf.push(''); jc++; continue; }
                    if (indentInfo(lc).col < 4) break;
                    codeBuf.push(stripIndent(lc, 4));
                    jc++;
                }
                while (codeBuf.length && codeBuf[codeBuf.length - 1] === '') codeBuf.pop();
                blocks.push({ t: 'code', info: '', text: codeBuf.join('\n') });
                i = jc;
                continue;
            }

            /* ---- 段落（含 Setext 标题） ---- */
            var paraLines = [];
            var jp = i;
            var setextDone = false;
            while (jp < n) {
                var rl = lines[jp];
                if (isBlankLine(rl)) break;
                if (jp > i) {
                    // Setext 下划线：段落后面紧跟 === / ---
                    if (SETEXT_RE.test(rl)) {
                        blocks.push({
                            t: 'heading',
                            level: rl.trim().charAt(0) === '=' ? 1 : 2,
                            raw: paraLines.join('\n')
                        });
                        jp++;
                        setextDone = true;
                        break;
                    }
                    // 表格可以打断段落（GFM 参考实现要求表前有空行，但本站
                    // site_info_2 的表格就紧贴在列表项正文后面，这里放宽成
                    // "下一行是分隔行就另起一张表"，属有意的宽松扩展）
                    if (rl.indexOf('|') !== -1 && jp + 1 < n && isDelimiterRow(lines[jp + 1])) break;
                    if (startsBlock(rl)) break;
                }
                paraLines.push(rl.replace(/^[ \t]+/, ''));
                jp++;
            }
            if (setextDone) { i = jp; continue; }
            if (paraLines.length) {
                blocks.push({ t: 'paragraph', raw: paraLines.join('\n') });
                i = jp;
                continue;
            }
            // 兜底：理论上到不了这里，防死循环
            i++;
        }
        return blocks;
    }

    // 列表解析：支持嵌套、紧凑/松散、起始编号与任务列表
    function parseList(lines, start, ctx, depth) {
        var firstLine = lines[start];
        var firstInfo = indentInfo(firstLine);
        var firstM = listMarker(firstLine, firstInfo);
        var ordered = firstM.ordered;
        var listKey = ordered ? firstM.delim : firstM.marker;
        var startNum = ordered ? firstM.start : 1;
        var items = [];
        var loose = false;
        var blankBetween = false;
        var i = start;

        while (i < lines.length) {
            var line = lines[i];
            if (isBlankLine(line)) {
                // 空行：可能只是列表项之间的间距，也可能列表到此结束
                blankBetween = true;
                i++;
                continue;
            }
            var info = indentInfo(line);
            var mk = listMarker(line, info);
            if (!mk) break;
            if (mk.ordered !== ordered) break;
            if ((ordered ? mk.delim : mk.marker) !== listKey) break;

            if (blankBetween && items.length) loose = true;
            blankBetween = false;

            var gapCols = widthOf(mk.gap);
            var contentCol = info.col + mk.markerLen + (gapCols > 4 ? 1 : gapCols);
            // 标记后隔了 4 列以上：只算 1 列，剩下的空白是内容的一部分（可能构成缩进代码块）
            var firstContent = gapCols > 4
                ? new Array(gapCols - 1 + 1).join(' ') + mk.rest
                : mk.rest;
            var itemLines = [firstContent];
            var j = i + 1;
            var pendingBlank = false;   // 刚吞过空行（决定是否还算"惰性续行"）
            var strict = false;         // 项内是否出现过空行（→ 松散列表）
            var lazyOk = !startsBlock(firstContent);
            while (j < lines.length) {
                var raw = lines[j];
                if (isBlankLine(raw)) {
                    itemLines.push('');
                    pendingBlank = true;
                    lazyOk = false;      // 空行之后不能再往本项段落里续
                    j++;
                    continue;
                }
                var ri = indentInfo(raw);
                if (ri.col >= contentCol) {
                    if (pendingBlank) strict = true;
                    pendingBlank = false;
                    itemLines.push(stripIndent(raw, contentCol));
                    j++;
                    continue;
                }
                // 同级新项目：中间夹了空行 → 整个列表变松散（规范如此）
                var nm = listMarker(raw, ri);
                if (nm && ri.col <= 3 && nm.ordered === ordered && (nm.ordered ? nm.delim : nm.marker) === listKey) {
                    if (pendingBlank) loose = true;
                    break;
                }
                if (startsBlock(raw)) break;
                // 惰性续行：归到当前项的段落里
                if (!lazyOk) break;
                itemLines.push(raw.replace(/^[ \t]+/, ''));
                j++;
            }
            while (itemLines.length && itemLines[itemLines.length - 1] === '') itemLines.pop();
            if (strict) loose = true;

            var itemBlocks = parseBlocks(itemLines, ctx, depth + 1);
            // 任务列表：段落开头是 [ ] / [x]（GFM）
            var task = null;
            if (!ordered && itemBlocks.length && itemBlocks[0].t === 'paragraph') {
                var tm = /^\[([ xX])\][ \t]+/.exec(itemBlocks[0].raw);
                if (tm) {
                    task = tm[1].toLowerCase() === 'x';
                    itemBlocks[0].raw = itemBlocks[0].raw.slice(tm[0].length);
                }
            }
            items.push({ blocks: itemBlocks, task: task });
            i = j;
        }

        return {
            node: { t: 'list', ordered: ordered, start: startNum, tight: !loose, items: items },
            next: i
        };
    }

    /* ============================================================
       五、渲染
       ============================================================ */

    function renderCodeBlock(info, text, ctx) {
        var rawInfo = String(info == null ? '' : info).trim();
        var firstWord = (rawInfo.split(/[ \t]+/)[0] || '');
        var token = firstWord.replace(/[^\w-]/g, '');
        var H = ctx.highlight || (global && global.LongwayHighlight) || null;
        var canon = '';
        var body = null;
        if (H && token && typeof H.highlight === 'function') {
            try {
                if (typeof H.canonical === 'function') canon = H.canonical(token) || '';
                if (canon) body = H.highlight(text, token);
            } catch (e) {
                body = null;
            }
        }
        if (body == null) body = escapeHtml(text);
        var label = rawInfo || 'text';
        var cls = token ? ' class="language-' + escapeHtml(token) + '"' : '';
        var dataLang = canon ? ' data-lang="' + escapeHtml(canon) + '"' : '';
        return '<div class="md-code"' + dataLang + '>' +
            '<div class="md-code-bar">' +
                '<span class="md-code-lang">' + escapeHtml(label) + '</span>' +
                '<button class="md-code-copy" type="button" aria-label="复制代码" title="复制代码"></button>' +
            '</div>' +
            '<pre><code' + cls + '>' + body + '</code></pre>' +
            '</div>';
    }

    function renderInlineNodes(nodes, ctx) {
        var out = '';
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            switch (n.t) {
                case 'text':
                    out += escapeHtml(n.v);
                    break;
                case 'code':
                    out += '<code>' + escapeHtml(n.v) + '</code>';
                    break;
                case 'html':
                    out += cleanHtml(n.v, ctx);
                    break;
                case 'br':
                    out += '<br />\n';
                    break;
                case 'em':
                    out += '<em>' + renderInlineNodes(n.children, ctx) + '</em>';
                    break;
                case 'strong':
                    out += '<strong>' + renderInlineNodes(n.children, ctx) + '</strong>';
                    break;
                case 'del':
                    out += '<del>' + renderInlineNodes(n.children, ctx) + '</del>';
                    break;
                case 'link': {
                    var inner = renderInlineNodes(n.children, ctx);
                    var href = ctx.resolveUrl(n.href);
                    if (!href) { out += inner; break; }
                    out += '<a href="' + escapeHtml(href) + '"' +
                        (n.title ? ' title="' + escapeHtml(n.title) + '"' : '') +
                        ' target="_blank" rel="noopener">' + inner + '</a>';
                    break;
                }
                case 'image': {
                    var src = ctx.resolveUrl(n.src);
                    if (!src) { out += escapeHtml(n.alt || ''); break; }
                    out += '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(n.alt || '') + '"' +
                        (n.title ? ' title="' + escapeHtml(n.title) + '"' : '') + '>';
                    break;
                }
                default:
                    break;
            }
        }
        return out;
    }

    function renderTable(b, ctx) {
        function cell(text, tag, idx) {
            var align = b.aligns[idx] || '';
            var style = align ? ' style="text-align:' + align + '"' : '';
            var raw = String(text == null ? '' : text).trim();
            return '<' + tag + style + '>' + renderInlineNodes(parseInlines(raw, ctx), ctx) + '</' + tag + '>';
        }
        var cols = b.header.length;
        var out = '<div class="md-table-wrap"><table><thead><tr>';
        for (var c = 0; c < cols; c++) out += cell(b.header[c], 'th', c);
        out += '</tr></thead>';
        if (b.rows.length) {
            out += '<tbody>';
            for (var r = 0; r < b.rows.length; r++) {
                out += '<tr>';
                for (var c2 = 0; c2 < cols; c2++) out += cell(b.rows[r][c2], 'td', c2);
                out += '</tr>';
            }
            out += '</tbody>';
        }
        out += '</table></div>';
        return out;
    }

    function renderItemContent(item, tight, ctx) {
        var out = '';
        var first = true;
        for (var i = 0; i < item.blocks.length; i++) {
            var blk = item.blocks[i];
            if (blk.t === 'paragraph') {
                var inner = renderInlineNodes(parseInlines(blk.raw, ctx), ctx);
                if (first && item.task !== null) {
                    out += '<input type="checkbox" disabled' + (item.task ? ' checked' : '') + '>' +
                        '<span class="md-task-text">' + inner + '</span>';
                } else if (tight) {
                    // 紧凑列表：段落不带 <p>（与 CommonMark 的 tight list 一致）
                    out += inner;
                } else {
                    out += '<p>' + inner + '</p>';
                }
            } else {
                out += renderBlock(blk, ctx);
            }
            first = false;
        }
        return out;
    }

    function renderList(b, ctx) {
        var tag = b.ordered ? 'ol' : 'ul';
        var out = '<' + tag + (b.ordered && b.start !== 1 ? ' start="' + b.start + '"' : '') + '>';
        for (var i = 0; i < b.items.length; i++) {
            var item = b.items[i];
            var cls = item.task === null ? '' : ' class="md-task' + (item.task ? ' is-checked' : '') + '"';
            out += '<li' + cls + '>' + renderItemContent(item, b.tight, ctx) + '</li>';
        }
        out += '</' + tag + '>';
        return out;
    }

    function renderBlock(b, ctx) {
        switch (b.t) {
            case 'paragraph':
                return '<p>' + renderInlineNodes(parseInlines(b.raw, ctx), ctx) + '</p>';
            case 'heading':
                return '<h' + b.level + '>' + renderInlineNodes(parseInlines(b.raw, ctx), ctx) + '</h' + b.level + '>';
            case 'code':
                return renderCodeBlock(b.info, b.text, ctx);
            case 'html':
                return cleanHtml(b.raw, ctx);
            case 'hr':
                return '<hr>';
            case 'blockquote':
                return '<blockquote>' + renderBlocks(b.children, ctx) + '</blockquote>';
            case 'list':
                return renderList(b, ctx);
            case 'table':
                return renderTable(b, ctx);
            default:
                return '';
        }
    }

    function renderBlocks(blocks, ctx) {
        var out = '';
        for (var i = 0; i < blocks.length; i++) out += renderBlock(blocks[i], ctx);
        return out;
    }

    /* ============================================================
       六、对外接口
       ============================================================ */

    function makeContext(options) {
        var opts = options || {};
        return {
            folder: opts.folder || '',
            html: opts.html !== false,
            sanitize: opts.sanitize !== false,
            // 相对路径解析交给调用方（blog.js 会拼成文章文件夹下的路径）
            resolveUrl: typeof opts.resolveUrl === 'function' ? opts.resolveUrl : defaultResolveUrl,
            highlight: opts.highlightLib || null,
            refs: Object.create(null)
        };
    }

    function render(md, options) {
        var ctx = makeContext(options);
        var src = String(md == null ? '' : md).replace(/\r\n?/g, '\n');
        if (!src.trim()) return '';
        var blocks = parseBlocks(src.split('\n'), ctx, 0);
        return renderBlocks(blocks, ctx);
    }

    function renderInline(text, options) {
        var ctx = makeContext(options);
        var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
        return renderInlineNodes(parseInlines(src, ctx), ctx);
    }

    return {
        version: VERSION,
        render: render,
        renderInline: renderInline,
        escapeHtml: escapeHtml
    };
});
