/* ============================================================
   LongwayHtml（lib/js/html.js）
   —— 卡片内 HTML 片段的安全渲染器

   定位：把"作者写在卡片里的 HTML 片段"变成能直接塞进 DOM 的内容，
   同时保证它不会执行脚本、不会注入事件处理器、不会把危险协议带进
   href/src。它**不生成任何组件**（头像、标签片、按钮、介绍卡布局都不管），
   只做三件事：
     ① 白名单清洗（标签 / 属性 / URL 协议；脚本、样式表、表单整段丢弃）；
     ② 提供一个中性的排版外壳 `.lg-html`（基础排版见 lib/css/html.css）；
     ③ 把结果挂进容器（可选：自动扫描 data-lg-* 属性）。

   —— 对外 API（全部挂在 window.LongwayHtml 上）——
     LongwayHtml.render(html, options)      → 清洗 + 套外壳后的 HTML 字符串
     LongwayHtml.sanitize(html, options)    → 只清洗，不套外壳（返回片段）
     LongwayHtml.mount(target, source, opts) → Promise<Element>，把内容挂进容器
     LongwayHtml.autoMount(root, options)   → Promise<Element[]>，扫描 data-lg-html
     LongwayHtml.escapeHtml(text)           → & < > " ' 转义
     LongwayHtml.version

   —— mount / autoMount 的 source 可以是 ——
     '一段 HTML 字符串'
     { url: 'lib/documents/cards/intro.html' }        先 fetch 再渲染
     { template: '#introTpl' }                        从 <template> / <script type="text/html"> 取
     { element: node }                                从某个元素的 innerHTML 取

   —— autoMount 扫描的写法 ——
     <div data-lg-html data-lg-src="lib/documents/cards/intro.html"></div>
     <div data-lg-html data-lg-template="#introTpl"></div>
     <div data-lg-html>这里写片段，会先被清洗再原样放回来</div>
     可选：data-lg-align="left|center"、data-lg-class="额外类名"、data-lg-nowrapper

   —— options ——
     wrapper        true  套 .lg-html 外壳（sanitize 不受影响）
     wrapperClass  附加在外壳上的类名，如 'lg-html--left'
     align          'left' | 'center'，给外壳加对齐修饰类
     html           默认 true；传 false 则**完全转义**成文字（等价于只显示源码）
     sanitize       默认 true；传 false 原样输出（危险，只在完全可信时用）
     allowInlineStyle  默认 true：允许 style 属性（会拦 expression()/javascript:）
     allowId        默认 false：默认丢掉 id，避免卡片内容跟页面 id 撞车
     resolveUrl     function(raw) → 安全 URL 或 null；默认拦危险协议、放行相对路径
     maxLength      默认 200000，超长直接抛 RangeError（防病态输入）
     onError        mount 失败时的回调（autoMount 用它记录，不打断整页）

   —— 安全模型（按"卡片内容"收窄，不是文章正文的全量白名单）——
     · 整段丢弃（连内容）：script / style / iframe / object / embed / form 及其控件 /
       template / svg / math / canvas / base / meta / link 等；
     · 不在白名单的标签：**拆壳**，只保留内部文字（不会整段吞掉内容）；
     · on* 事件属性一律丢弃；data-* / aria-* 放行；
     · href / src / poster / cite 过协议校验：javascript: / vbscript: / file: / blob: /
       about: / chrome: / jar: / view-source: 一律丢弃；data: 只允许 data:image/*；
     · <a target="_blank"> 自动补 rel="noopener noreferrer"；
     · <img> 没有 alt 时补 alt=""，并默认加 loading="lazy" decoding="async"；
     · 文本里的孤立 "<" 会被转义，避免残缺标签在插入时"复活"。
     ※ 它和 markdown.js 里的清洗器**策略不同、互不依赖**：那边面向文章正文（允许
       <style>、放宽了标签面），这边面向卡片（更窄、更保守）。要改卡片放行范围，
       只改本文件的 ALLOWED_TAGS / ALLOWED_ATTRS 即可。

   —— 一个最小示例（个人介绍卡片，HTML 片段放文件里）——
     lib/documents/home/intro.html：
       <h3>LongwayStar</h3>
       <p>写代码、折腾 RISC-V、偶尔写点随笔。</p>
       <ul>
         <li>GitHub：<a href="https://github.com/LongwayStar">@LongwayStar</a></li>
         <li>博客：<a href="#blog">本站「我的博客」</a></li>
       </ul>
     index.html 里：
       <section class="card">
         <h2>关于我</h2>
         <div data-lg-html data-lg-src="lib/documents/home/intro.html"></div>
       </section>
     想手动控制时机就关掉自动挂载，自己调：
       LongwayHtml.mount('#slot', { url: 'lib/documents/home/intro.html' });
   ============================================================ */
(function (global, factory) {
    var api = factory(global);
    if (typeof module === 'object' && module && module.exports) module.exports = api;
    if (global) global.LongwayHtml = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (global) {
    'use strict';

    var VERSION = '1.0.0';

    /* ------------------------------------------------------------
       白名单
       ------------------------------------------------------------ */

    // 整段丢弃（连内部内容一起丢）：脚本、样式表、嵌入对象、表单控件、SVG/Math 等
    var DROP_TAGS = {
        script: 1, style: 1, iframe: 1, frame: 1, frameset: 1, object: 1, embed: 1,
        applet: 1, param: 1, form: 1, input: 1, button: 1, select: 1, optgroup: 1,
        option: 1, textarea: 1, label: 1, fieldset: 1, legend: 1, output: 1, progress: 1,
        meter: 1, datalist: 1, template: 1, base: 1, link: 1, meta: 1, title: 1,
        noscript: 1, noembed: 1, noframes: 1, xmp: 1, svg: 1, math: 1, canvas: 1,
        dialog: 1, slot: 1, portal: 1
    };

    // 允许保留的标签（其余一律拆壳、只留文字）
    var ALLOWED_TAGS = {
        h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
        p: 1, div: 1, span: 1, br: 1, hr: 1, center: 1,
        a: 1, img: 1, picture: 1, source: 1,
        ul: 1, ol: 1, li: 1, dl: 1, dt: 1, dd: 1,
        table: 1, caption: 1, thead: 1, tbody: 1, tfoot: 1, tr: 1, th: 1, td: 1,
        col: 1, colgroup: 1,
        pre: 1, code: 1, kbd: 1, samp: 1, var: 1,
        blockquote: 1, q: 1, cite: 1, figure: 1, figcaption: 1,
        strong: 1, b: 1, em: 1, i: 1, u: 1, s: 1, del: 1, ins: 1, mark: 1, small: 1,
        sub: 1, sup: 1, abbr: 1, time: 1, address: 1,
        details: 1, summary: 1,
        section: 1, article: 1, aside: 1, header: 1, footer: 1, nav: 1, main: 1,
        audio: 1, video: 1, track: 1
    };

    // 自闭合（void）元素：不输出 </name>
    var VOID_TAGS = {
        area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
        link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
    };

    // 布尔属性：输出成无值形式（open / muted …），避免 open="" 这种别扭写法
    var BOOLEAN_ATTRS = {
        hidden: 1, open: 1, controls: 1, loop: 1, muted: 1, autoplay: 1,
        reversed: 1, playsinline: 1, default: 1, novalidate: 1
    };

    // 需要做协议校验 + 交给 resolveUrl 的属性
    var URL_ATTRS = { href: 1, src: 1, poster: 1, cite: 1 };

    // 其余允许的属性（on* 一律不在此列，且会被显式再拦一次）
    var ALLOWED_ATTRS = {
        'class': 1, title: 1, lang: 1, dir: 1, style: 1,
        align: 1, width: 1, height: 1, border: 1, cellpadding: 1, cellspacing: 1,
        colspan: 1, rowspan: 1, start: 1, reversed: 1, datetime: 1, cite: 1,
        target: 1, rel: 1, alt: 1, loading: 1, decoding: 1, sizes: 1,
        controls: 1, loop: 1, muted: 1, autoplay: 1, preload: 1, playsinline: 1,
        media: 1, type: 1, open: 1, hidden: 1
    };

    /* ------------------------------------------------------------
       基础工具
       ------------------------------------------------------------ */

    var ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return ESCAPE_MAP[ch]; });
    }

    // 标签扫描：<name attrs> / </name> / <name attrs />
    var TAG_RE = /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    // 属性扫描（支持无引号值）
    var ATTR_RE = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
    // 危险的内联样式写法
    var STYLE_DANGER_RE = /expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|@import|url\s*\(\s*['"]?\s*(?:javascript|vbscript)\s*:/i;

    function defaultResolveUrl(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (s === '') return null;
        // 判断时先去掉空白/控制字符，防 `java\nscript:` 这类绕过；输出仍用原值
        var compact = s.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
        if (/^(javascript|vbscript|file|blob|about|chrome|jar|view-source):/.test(compact)) return null;
        if (compact.indexOf('data:') === 0 && !/^data:image\//.test(compact)) return null;
        return s;
    }

    function normalizeOptions(options) {
        var opts = options || {};
        return {
            wrapper: opts.wrapper !== false,
            wrapperClass: opts.wrapperClass || '',
            align: opts.align === 'left' || opts.align === 'center' ? opts.align : '',
            html: opts.html !== false,
            sanitize: opts.sanitize !== false,
            allowInlineStyle: opts.allowInlineStyle !== false,
            allowId: opts.allowId === true,
            resolveUrl: typeof opts.resolveUrl === 'function' ? opts.resolveUrl : defaultResolveUrl,
            maxLength: typeof opts.maxLength === 'number' && opts.maxLength > 0 ? opts.maxLength : 200000,
            onError: typeof opts.onError === 'function' ? opts.onError : null
        };
    }

    /* ------------------------------------------------------------
       清洗
       ------------------------------------------------------------ */

    // 跳过一个"整段丢弃"的元素：一直找到配对的结束标签（支持同名嵌套），没有就丢到末尾
    function skipElement(src, from, name) {
        var re = new RegExp('<\\s*(\\/?)' + name + '\\b[^>]*>', 'gi');
        re.lastIndex = from;
        var depth = 1;
        var m;
        while ((m = re.exec(src)) !== null) {
            if (m[1] === '/') {
                depth--;
                if (depth === 0) return m.index + m[0].length;
            } else if (!/\/\s*>$/.test(m[0])) {
                depth++;
            }
        }
        return src.length;
    }

    function unquote(v) {
        if (v == null) return '';
        if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
        return v;
    }

    // 清洗属性，返回 [name, value] 数组（保持原顺序）
    function cleanAttrs(name, rawAttrs, opts) {
        var list = [];
        ATTR_RE.lastIndex = 0;
        var m;
        while ((m = ATTR_RE.exec(rawAttrs)) !== null) {
            var attr = m[1].toLowerCase();
            if (attr === name) continue;                       // 防止属性名混进标签名
            if (/^on/.test(attr)) continue;                    // on* 事件处理器：一律丢弃
            var val = unquote(m[2]);

            if (attr === 'id') {
                if (!opts.allowId) continue;                   // 默认丢 id，避免跟页面 id 撞车
            } else if (attr === 'style') {
                if (!opts.allowInlineStyle) continue;
                if (STYLE_DANGER_RE.test(val)) continue;
            } else if (URL_ATTRS[attr]) {
                var resolved = opts.resolveUrl(val);
                if (!resolved) {
                    // src/poster 不安全 → 整张图/媒体直接不输出（免得留下破图）
                    if (attr === 'src' || attr === 'poster') return null;
                    continue;                                  // href/cite 不安全 → 只丢属性
                }
                val = resolved;
            } else if (!ALLOWED_ATTRS[attr] && !/^data-/.test(attr) && !/^aria-/.test(attr)) {
                continue;                                      // 未知属性：丢弃
            }
            list.push([attr, val]);
        }
        return list;
    }

    function buildOpenTag(name, rawAttrs, opts) {
        var attrs = cleanAttrs(name, rawAttrs, opts);
        if (attrs === null) return '';                         // 属性阶段判定"整标签不要"

        var map = Object.create(null);
        for (var i = 0; i < attrs.length; i++) map[attrs[i][0]] = attrs[i][1];

        // 外链新窗口：自动补 rel，防止 window.opener 被反向控制
        if (name === 'a' && map.target && String(map.target).toLowerCase() === '_blank' && !map.rel) {
            attrs.push(['rel', 'noopener noreferrer']);
            map.rel = 'noopener noreferrer';
        }
        // 图片：补 alt 与懒加载
        if (name === 'img') {
            if (!('alt' in map)) attrs.push(['alt', '']);
            if (!('loading' in map)) attrs.push(['loading', 'lazy']);
            if (!('decoding' in map)) attrs.push(['decoding', 'async']);
        }

        var out = '<' + name;
        for (var k = 0; k < attrs.length; k++) {
            var key = attrs[k][0];
            var value = attrs[k][1];
            if (BOOLEAN_ATTRS[key] && (value === '' || value === key)) {
                out += ' ' + key;
            } else {
                out += ' ' + key + '="' + escapeHtml(value) + '"';
            }
        }
        return out + '>';
    }

    // 文本节点里的孤立 "<" 转义，避免残缺标签在插入 DOM 时"复活"成真标签
    function protectText(text) {
        return String(text).replace(/</g, '&lt;');
    }

    function sanitize(html, options) {
        var opts = normalizeOptions(options);
        var src = String(html == null ? '' : html);
        if (src.length > opts.maxLength) {
            throw new RangeError('LongwayHtml: 内容过长（' + src.length + ' > ' + opts.maxLength + ' 字符）');
        }
        // html:false = 完全转义成文字（用于"只想展示源码"的场合）
        if (!opts.html) return escapeHtml(src);
        if (!opts.sanitize) return src;

        src = src.replace(/<!--[\s\S]*?-->/g, '');             // 注释直接抹掉

        var out = '';
        var pos = 0;
        var m;
        TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(src)) !== null) {
            out += protectText(src.slice(pos, m.index));
            pos = m.index + m[0].length;

            var closing = m[1] === '/';
            var name = m[2].toLowerCase();

            if (DROP_TAGS[name]) {
                if (!closing) {
                    // 自闭合的丢弃标签（meta/link/base/input…）没有"内容"可吞，
                    // 只丢标签本身；否则会一路吞到文末（踩过）
                    if (!VOID_TAGS[name]) {
                        pos = skipElement(src, pos, name);
                        TAG_RE.lastIndex = pos;
                    }
                }
                continue;
            }
            if (!ALLOWED_TAGS[name]) continue;                  // 非白名单：拆壳留文字
            if (closing) {
                if (!VOID_TAGS[name]) out += '</' + name + '>';
                continue;
            }
            var open = buildOpenTag(name, m[3], opts);
            if (!open) continue;                                // img 的 src 不安全 → 整个不要
            out += open;
        }
        out += protectText(src.slice(pos));
        return out;
    }

    /* ------------------------------------------------------------
       渲染 / 挂载
       ------------------------------------------------------------ */

    function render(html, options) {
        var opts = normalizeOptions(options);
        var body = sanitize(html, opts);
        if (!opts.wrapper) return body;
        var cls = 'lg-html';
        if (opts.wrapperClass) cls += ' ' + opts.wrapperClass;
        if (opts.align) cls += ' lg-html--' + opts.align;
        return '<div class="' + escapeHtml(cls) + '">' + body + '</div>';
    }

    function resolveTarget(target) {
        if (!target) return null;
        if (typeof target === 'string') {
            return (global && global.document) ? global.document.querySelector(target) : null;
        }
        if (target.nodeType === 1) return target;
        return null;
    }

    // 读取 source 的原始 HTML 文本
    function readSource(source) {
        if (typeof source === 'string') return Promise.resolve(source);
        if (!source || typeof source !== 'object') {
            return Promise.reject(new Error('LongwayHtml: 不支持的 source 类型'));
        }
        if (source.url) {
            var doc = global && global.document;
            var fetchFn = (global && global.fetch) || (typeof fetch === 'function' ? fetch : null);
            if (!fetchFn) return Promise.reject(new Error('LongwayHtml: 当前环境没有 fetch'));
            var init = Object.assign({ cache: 'no-store' }, source.fetchOptions || {});
            return Promise.resolve(fetchFn(String(source.url), init)).then(function (res) {
                if (!res.ok) throw new Error('LongwayHtml: 读取失败 HTTP ' + res.status + '（' + source.url + '）');
                return res.text();
            });
        }
        if (source.template) {
            var doc2 = global && global.document;
            var el = doc2 ? doc2.querySelector(String(source.template)) : null;
            if (!el) return Promise.reject(new Error('LongwayHtml: 找不到模板 ' + source.template));
            return Promise.resolve(el.tagName === 'SCRIPT' ? el.textContent : el.innerHTML);
        }
        if (source.element && source.element.nodeType === 1) {
            var node = source.element;
            return Promise.resolve(node.tagName === 'SCRIPT' ? node.textContent : node.innerHTML);
        }
        return Promise.reject(new Error('LongwayHtml: source 需要 url / template / element 之一'));
    }

    function mount(target, source, options) {
        var opts = normalizeOptions(options);
        var el = resolveTarget(target);
        if (!el) {
            var err = new Error('LongwayHtml: 找不到容器 ' + String(target));
            if (opts.onError) opts.onError(err);
            return Promise.reject(err);
        }
        return readSource(source).then(function (raw) {
            el.innerHTML = render(raw, opts);
            el.setAttribute('data-lg-mounted', '1');
            return el.firstElementChild || el;
        }).catch(function (error) {
            if (opts.onError) opts.onError(error, el);
            throw error;
        });
    }

    /* 自动挂载：
       · 元素必须带 data-lg-html 属性；
       · 优先 data-lg-src（fetch 文件），其次 data-lg-template（选择器），
         都没有就读元素自身的 innerHTML（等于"锁定"手写片段）；
       · 已挂载过的元素打 data-lg-mounted，重复调用会跳过（force:true 可强制）。 */
    function autoMount(root, options) {
        var doc = (global && global.document) || null;
        if (!doc) return Promise.resolve([]);
        var scope = root ? resolveTarget(root) || doc : doc;
        var opts = normalizeOptions(options);
        var force = options && options.force === true;
        var nodes = Array.prototype.slice.call(scope.querySelectorAll('[data-lg-html]'));
        if (force) {
            nodes.forEach(function (el) { el.removeAttribute('data-lg-mounted'); });
        }
        nodes = nodes.filter(function (el) { return !el.hasAttribute('data-lg-mounted'); });
        return Promise.all(nodes.map(function (el) {
            var align = el.getAttribute('data-lg-align');
            var extra = el.getAttribute('data-lg-class');
            var local = Object.assign({}, options, {
                align: align === 'left' || align === 'center' ? align : '',
                wrapperClass: extra || '',
                wrapper: !el.hasAttribute('data-lg-nowrapper')
            });
            var source;
            if (el.hasAttribute('data-lg-src')) {
                source = { url: el.getAttribute('data-lg-src') };
            } else if (el.hasAttribute('data-lg-template')) {
                source = { template: el.getAttribute('data-lg-template') };
            } else {
                source = el.innerHTML;
            }
            var onError = local.onError;
            local.onError = function (error) {
                el.setAttribute('data-lg-error', String(error && error.message || error));
                var tip = doc.createElement('div');
                tip.className = 'lg-html lg-html--error';
                tip.textContent = '卡片内容加载失败：' + String(error && error.message || error);
                el.innerHTML = '';
                el.appendChild(tip);
                if (onError) onError(error, el);
            };
            return mount(el, source, local).catch(function () { return el; });
        }));
    }

    // 页面加载完成后自动扫描一次（没有 data-lg-html 元素时不做任何事）
    (function autoBoot() {
        var doc = global && global.document;
        if (!doc) return;
        var run = function () {
            autoMount(doc).catch(function (error) {
                if (global.console && global.console.warn) global.console.warn('[LongwayHtml]', error);
            });
        };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', run);
        else run();
    })();

    return {
        version: VERSION,
        render: render,
        sanitize: sanitize,
        mount: mount,
        autoMount: autoMount,
        escapeHtml: escapeHtml,
        // 便于调试：当前放行的标签 / 整段丢弃的标签
        allowedTags: function () { return Object.keys(ALLOWED_TAGS); },
        droppedTags: function () { return Object.keys(DROP_TAGS); }
    };
});
