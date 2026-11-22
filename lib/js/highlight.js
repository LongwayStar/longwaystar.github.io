/* ============================================================
   LongwaySite 代码高亮模块 (highlight.js)
   纯手写扫描器：无依赖、无构建、不碰 DOM，浏览器与 Node 都能用。
   浏览器：window.LongwayHighlight
   Node  ：require('./lib/js/highlight.js') 拿同一个对象（便于单测）
   支持：C / C++（共用一套 tokenizer）、Python、汇编（x86 / RISC-V / GAS）

   ---------- 输出契约（配合 markdown 渲染器） ----------
   highlight(code, lang) 返回的 HTML 只可能出现两种东西：
     1) <span class="tok-xxx">…</span>
     2) 转义后的纯文本
   不放别的标签、类名、内联样式或属性。所有文本一律过 escapeHtml()
   （& < > " ' 五个字符）。把返回串塞进 DOM 后，textContent 必须与输入
   code 逐字节相等（缩进、换行、尾随空格都算）。
   为守住这条，highlight() 在渲染前会先做一次「token 拼接 === 原文」的
   自校验：只要对不上，整体退回纯转义输出——宁可不高亮，也绝不吞字、
   重字或错位。语言不认识时返回 null，调用方自行退回纯转义。

   ---------- 怎么加一门新语言（三步走） ----------
   第 1 步（本文件）：写一个 tokenizer 并注册。
       function tokenizeGo(code) {
           const list = [];
           // …逐段扫描 code，每段 push(list, 'type', 原文片段)
           return list;                    // [{ type, text }, …]
       }
       register('go', { aliases: ['go', 'golang'], tokenize: tokenizeGo });
     tokenizer 的三条硬规矩：
       · type 只能是下方 TOKEN_TYPES 里登记过的名字（不带 tok- 前缀）；
         空串 '' 表示「这段不高亮，按纯文本输出」。
       · 所有 token 的 text 按顺序拼接后必须 === 传入的 code，
         一个空格都不能丢、不能多。
       · 扫描器只许往前走：每轮都要把游标推到不小于原位置（建议一律
         严格推进），遇到不认识的字符就原样吐出去（type 用 ''），
         绝不允许原地打转，否则会死循环。
     注册位置随便，只要早于第一次 highlight() 调用即可；本文件末尾
     自带的三门语言就是按同样方式注册的，照抄即可。
   第 2 步（别名归一）：把别名写进 register 的 aliases 数组即可，
     会自动转小写，规范 id 本身也自动可查；canonical() 负责还原。
   第 3 步（配色）：在 lib/css/codestyle.css 里给新语言/新 token 配色。
     通用的颜色在 :root 与 [data-theme="dark"] 两套 --code-* 变量里；
     某门语言想单独覆盖，再写一条 .md-code[data-lang="go"] .tok-keyword。
   三步做完，Markdown 渲染器那边一行都不用改。
   ============================================================ */
(function() {
    'use strict';

    /* ---------- token 词表 ----------
       只准用这些名字：codestyle.css 是按这份清单逐条配色的，
       随手加新词只会得到「没有任何颜色」的 span。 */
    const TOKEN_TYPES = {
        'comment': 1, 'string': 1, 'escape': 1, 'number': 1,
        'keyword': 1, 'keyword-flow': 1, 'preproc': 1, 'directive': 1,
        'label': 1, 'register': 1, 'mnemonic': 1, 'type': 1,
        'function': 1, 'builtin': 1, 'variable': 1, 'parameter': 1,
        'constant': 1, 'operator': 1, 'punct': 1, 'decorator': 1,
        'attr': 1, 'namespace': 1, 'macro': 1, 'regex': 1
    };

    /* ---------- 语言注册表 ---------- */
    const LANGUAGES = Object.create(null);   // 规范 id → { id, tokenize }
    const ALIAS_MAP = Object.create(null);   // 小写别名 → 规范 id

    /* ---------- 基础工具 ---------- */

    // 统一转义：& 必须最先换，否则会把后面生成的实体再转一次
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // 压入一个 token；空文本直接丢弃（空 span 没有意义）
    function push(list, type, text) {
        if (!text) return;
        list.push({ type: type || '', text: text });
    }

    function isDigit(ch) {
        return ch >= '0' && ch <= '9';
    }
    function isIdentStart(ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
    }
    function isIdentChar(ch) {
        return isIdentStart(ch) || isDigit(ch);
    }
    function isSpaceCh(ch) {
        return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\v';
    }

    // 用空格分隔的字符串造一个查找表（比数组 indexOf 快，也不怕原型链）
    function makeSet(words) {
        const set = Object.create(null);
        const arr = words.split(' ');
        for (let i = 0; i < arr.length; i++) {
            if (arr[i]) set[arr[i]] = 1;
        }
        return set;
    }
    function inSet(set, word) {
        return set[word] === 1;
    }

    // 从 i 往前看：i 之前（同一行内）是否只有空白。行首判断全靠它
    function isAtLineStart(code, i) {
        let p = i - 1;
        while (p >= 0) {
            const ch = code.charAt(p);
            if (ch === '\n') return true;
            if (ch !== ' ' && ch !== '\t' && ch !== '\r') return false;
            p--;
        }
        return true;
    }

    /* ---------- 通用扫描片段 ---------- */

    // 行注释吃到行尾（不含换行符本身），返回结束下标
    function scanLineComment(code, start) {
        const n = code.length;
        let j = start;
        while (j < n) {
            if (code.charAt(j) === '\n') return j;
            j++;
        }
        return n;
    }

    // 块注释 /* … */，没闭合就一路吃到末尾
    function scanBlockComment(code, start) {
        const close = code.indexOf('*/', start + 2);
        return close === -1 ? code.length : close + 2;
    }

    // 引号字面量：反斜杠转义；allowNewline 为 false 时遇到换行就收手
    // （未闭合的串只吃到行尾，剩下的交给主循环，绝不吞别的行）
    function scanQuoted(code, start, quote, allowNewline) {
        const n = code.length;
        let j = start + 1;
        while (j < n) {
            const ch = code.charAt(j);
            if (ch === '\\') { j += 2; continue; }
            if (ch === quote) return j + 1;
            if (ch === '\n' && !allowNewline) return j;
            j++;
        }
        return n;
    }

    // 把 [start, end) 这段字面量切成「串 / 转义」若干 token，
    // 切片首尾相接，一个字符都不会漏
    function pushLiteral(list, code, start, end, type) {
        let p = start;
        let seg = start;
        while (p < end) {
            if (code.charAt(p) === '\\' && p + 1 < end) {
                if (p > seg) push(list, type, code.slice(seg, p));
                push(list, 'escape', code.slice(p, p + 2));
                p += 2;
                seg = p;
            } else {
                p++;
            }
        }
        if (end > seg) push(list, type, code.slice(seg, end));
    }

    // 扫一串标识符，返回结束下标
    function scanIdent(code, start) {
        const n = code.length;
        let j = start;
        while (j < n && isIdentChar(code.charAt(j))) j++;
        return j;
    }

    // 数字：只从 i 往后取一小段正则（有界切片，避免大文件里反复切全文）
    function matchBounded(re, code, i) {
        const chunk = code.slice(i, i + 64);
        const m = re.exec(chunk);
        if (!m || m[0].length === 0) return -1;
        return i + m[0].length;
    }

    /* ---------- C / C++ ---------- */

    const C_KEYWORDS = makeSet(
        'auto const extern inline register restrict static volatile typedef union enum struct sizeof ' +
        'alignof alignas static_assert thread_local _Atomic _Bool _Complex _Imaginary ' +
        'signed unsigned short long int char void float double ' +
        'class namespace template typename public private protected virtual operator new delete ' +
        'this friend explicit mutable constexpr noexcept using try catch throw override final'
    );
    const C_FLOW = makeSet(
        'if else for while do switch case default return break continue goto'
    );
    const C_TYPES = makeSet(
        'size_t ssize_t ptrdiff_t wchar_t char16_t char32_t intptr_t uintptr_t ' +
        'int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t ' +
        'int_least8_t int_least16_t int_least32_t int_least64_t ' +
        'uint_least8_t uint_least16_t uint_least32_t uint_least64_t ' +
        'int_fast8_t int_fast16_t int_fast32_t int_fast64_t ' +
        'uint_fast8_t uint_fast16_t uint_fast32_t uint_fast64_t ' +
        'intmax_t uintmax_t VA_LIST va_list FILE off_t time_t pid_t socklen_t boolean ' +
        'string vector map set pair size_type iterator'
    );
    const C_CONSTANTS = makeSet('NULL true false nullptr TRUE FALSE');

    // C 数字：十进制 / 0x / 0b / 浮点 / 科学计数 + u U l L f F 后缀
    const RE_C_NUMBER = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[uUlLfF]*/;
    const C_OP_CHARS = '+-*/%=<>!&|^~?:';
    const C_PUNCT_CHARS = '(){}[];,.#';

    // 预处理指令：从行首 # 一直吃到逻辑行结束（行尾反斜杠续行并入同一行）
    function tokenizeCPreproc(code, start, list) {
        const n = code.length;
        let end = start;
        while (end < n) {
            if (code.charAt(end) === '\n') {
                let k = end - 1;
                if (k >= start && code.charAt(k) === '\r') k--;
                if (k >= start && code.charAt(k) === '\\') { end++; continue; }
                break;
            }
            end++;
        }
        if (end > n) end = n;

        // "#" + 空白 + 指令名
        let j = start + 1;
        while (j < end && (code.charAt(j) === ' ' || code.charAt(j) === '\t')) j++;
        let k = j;
        while (k < end && isIdentChar(code.charAt(k))) k++;
        const name = code.slice(j, k).toLowerCase();
        push(list, 'preproc', code.slice(start, k));

        let p = k;
        if (name === 'include' || name === 'include_next' || name === 'import') {
            // 头文件名：<stdio.h> 或 "foo.h"，按字符串上色。
            // 跳过的空白必须补一个 token：少吐一个空格，拼接就对不上原文了
            const gap = p;
            while (p < end && (code.charAt(p) === ' ' || code.charAt(p) === '\t')) p++;
            push(list, 'preproc', code.slice(gap, p));
            const c = code.charAt(p);
            if (c === '<') {
                let close = code.indexOf('>', p);
                close = (close === -1 || close >= end) ? end : close + 1;
                push(list, 'string', code.slice(p, close));
                p = close;
            } else if (c === '"') {
                let close = scanQuoted(code, p, '"', false);
                if (close > end) close = end;
                pushLiteral(list, code, p, close, 'string');
                p = close;
            }
            push(list, 'preproc', code.slice(p, end));
            return end;
        }
        if (name === 'define') {
            // 宏名单独标出来，方便一眼分清 define 和它的正文
            const gap = p;
            while (p < end && (code.charAt(p) === ' ' || code.charAt(p) === '\t')) p++;
            push(list, 'preproc', code.slice(gap, p));
            let nameEnd = p;
            while (nameEnd < end && isIdentChar(code.charAt(nameEnd))) nameEnd++;
            if (nameEnd > p) {
                push(list, 'macro', code.slice(p, nameEnd));
                p = nameEnd;
            }
            push(list, 'preproc', code.slice(p, end));
            return end;
        }
        push(list, 'preproc', code.slice(p, end));
        return end;
    }

    function tokenizeC(code) {
        const list = [];
        const n = code.length;
        let i = 0;
        while (i < n) {
            const ch = code.charAt(i);
            const next = i + 1 < n ? code.charAt(i + 1) : '';

            // 空白：原样输出，不产生 span
            if (isSpaceCh(ch)) {
                let j = i + 1;
                while (j < n && isSpaceCh(code.charAt(j))) j++;
                push(list, '', code.slice(i, j));
                i = j;
                continue;
            }
            // 注释
            if (ch === '/' && next === '/') {
                const j = scanLineComment(code, i);
                push(list, 'comment', code.slice(i, j));
                i = j;
                continue;
            }
            if (ch === '/' && next === '*') {
                const j = scanBlockComment(code, i);
                push(list, 'comment', code.slice(i, j));
                i = j;
                continue;
            }
            // 字符串 / 字符字面量
            if (ch === '"' || ch === '\'') {
                const j = scanQuoted(code, i, ch, false);
                pushLiteral(list, code, i, j, 'string');
                i = j;
                continue;
            }
            // 预处理指令只认行首的 #
            if (ch === '#' && isAtLineStart(code, i) && next !== '#') {
                i = tokenizeCPreproc(code, i, list);
                continue;
            }
            // 数字
            if (isDigit(ch) || (ch === '.' && isDigit(next))) {
                const end = matchBounded(RE_C_NUMBER, code, i);
                if (end > i) {
                    push(list, 'number', code.slice(i, end));
                    i = end;
                    continue;
                }
            }
            // 标识符：先看关键字/类型/常量，再看是不是函数调用
            if (isIdentStart(ch)) {
                const j = scanIdent(code, i);
                const word = code.slice(i, j);
                let type = '';
                if (inSet(C_FLOW, word)) type = 'keyword-flow';
                else if (inSet(C_KEYWORDS, word)) type = 'keyword';
                else if (inSet(C_TYPES, word)) type = 'type';
                else if (inSet(C_CONSTANTS, word)) type = 'constant';
                else if (code.charAt(j) === '(') type = 'function';
                push(list, type, word);
                i = j;
                continue;
            }
            // 运算符（连续最多吃 3 个，免得 4 个以上连成一片看不清）
            if (C_OP_CHARS.indexOf(ch) !== -1) {
                let j = i + 1;
                while (j < n && j - i < 3 && C_OP_CHARS.indexOf(code.charAt(j)) !== -1) j++;
                push(list, 'operator', code.slice(i, j));
                i = j;
                continue;
            }
            // 标点
            if (C_PUNCT_CHARS.indexOf(ch) !== -1) {
                push(list, 'punct', ch);
                i += 1;
                continue;
            }
            // 其它（中文、UTF-8、各种没预料到的字符）：原样吐出去，游标必须前进
            push(list, '', ch);
            i += 1;
        }
        return list;
    }

    /* ---------- Python ---------- */

    const PY_KEYWORDS = makeSet(
        'def class import from as lambda global nonlocal in is not and or ' +
        'async await'
    );
    const PY_FLOW = makeSet(
        'if elif else for while try except finally with return yield raise assert ' +
        'pass break continue del match case'
    );
    const PY_CONSTANTS = makeSet('True False None NotImplemented Ellipsis __debug__');
    const PY_VARIABLES = makeSet('self cls');
    const PY_BUILTINS = makeSet(
        'print len range int str float list dict set frozenset tuple bool bytes bytearray ' +
        'open type isinstance issubclass super enumerate zip map filter sorted reversed ' +
        'sum min max abs any all round divmod pow repr format input chr ord id hash iter next ' +
        'hasattr getattr setattr delattr vars dir callable object staticmethod classmethod ' +
        'property slice complex memoryview bin oct hex ascii eval exec compile globals locals'
    );
    const PY_TYPES = makeSet(
        'Exception BaseException ValueError TypeError KeyError IndexError RuntimeError ' +
        'StopIteration StopAsyncIteration OSError IOError AttributeError NameError ' +
        'NotImplementedError ZeroDivisionError AssertionError ImportError ModuleNotFoundError ' +
        'FileNotFoundError PermissionError OverflowError RecursionError SystemExit KeyboardInterrupt'
    );

    // Python 数字：0x / 0b / 0o / 下划线 / 浮点 / 科学计数 / 复数 j 后缀
    const RE_PY_NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)[jJlL]?/;
    const PY_OP_CHARS = '+-*/%=<>!&|^~:@';
    const PY_PUNCT_CHARS = '(){}[],.;';

    // 判断 i 处是不是 Python 字符串起点（可带 f/r/b/u 前缀，最多两个字母）
    // 是则返回结束下标，否则返回 -1
    function scanPyString(code, i) {
        const n = code.length;
        let prefixLen = 0;
        while (i + prefixLen < n && prefixLen < 2) {
            const c = code.charAt(i + prefixLen).toLowerCase();
            if (c !== 'r' && c !== 'b' && c !== 'u' && c !== 'f') break;
            prefixLen++;
        }
        const q = i + prefixLen;
        const quote = code.charAt(q);
        if (quote !== '"' && quote !== '\'') return -1;
        // 三个引号连写 → 三引号字符串，可以跨行
        if (code.slice(q, q + 3) === quote + quote + quote) {
            const closeSeq = quote + quote + quote;
            let j = q + 3;
            while (j < n) {
                if (code.charAt(j) === '\\') { j += 2; continue; }
                if (code.slice(j, j + 3) === closeSeq) return j + 3;
                j++;
            }
            return n;
        }
        return scanQuoted(code, q, quote, false);
    }

    function tokenizePython(code) {
        const list = [];
        const n = code.length;
        let i = 0;
        while (i < n) {
            const ch = code.charAt(i);
            const next = i + 1 < n ? code.charAt(i + 1) : '';

            if (isSpaceCh(ch)) {
                let j = i + 1;
                while (j < n && isSpaceCh(code.charAt(j))) j++;
                push(list, '', code.slice(i, j));
                i = j;
                continue;
            }
            // # 注释（Python 里不存在「# 是运算符」的情况，一路吃到行尾即可）
            if (ch === '#') {
                const j = scanLineComment(code, i);
                push(list, 'comment', code.slice(i, j));
                i = j;
                continue;
            }
            // 字符串要先于标识符判断，否则 f"…" 里的 f 会被当成变量
            const strEnd = scanPyString(code, i);
            if (strEnd > i) {
                pushLiteral(list, code, i, strEnd, 'string');
                i = strEnd;
                continue;
            }
            // 装饰器：只有行首的 @ 才算（其余 @ 是矩阵乘运算符）
            if (ch === '@' && isAtLineStart(code, i)) {
                let j = i + 1;
                while (j < n && (isIdentChar(code.charAt(j)) || code.charAt(j) === '.')) j++;
                if (j > i + 1) {
                    push(list, 'decorator', code.slice(i, j));
                } else {
                    push(list, 'operator', ch);
                }
                i = j;
                continue;
            }
            if (isDigit(ch) || (ch === '.' && isDigit(next))) {
                const end = matchBounded(RE_PY_NUMBER, code, i);
                if (end > i) {
                    push(list, 'number', code.slice(i, end));
                    i = end;
                    continue;
                }
            }
            if (isIdentStart(ch)) {
                const j = scanIdent(code, i);
                const word = code.slice(i, j);
                let type = '';
                if (inSet(PY_CONSTANTS, word)) type = 'constant';
                else if (inSet(PY_FLOW, word)) type = 'keyword-flow';
                else if (inSet(PY_KEYWORDS, word)) type = 'keyword';
                else if (inSet(PY_VARIABLES, word)) type = 'variable';
                else if (inSet(PY_BUILTINS, word)) type = 'builtin';
                else if (inSet(PY_TYPES, word)) type = 'type';
                else if (code.charAt(j) === '(') type = 'function';
                push(list, type, word);
                i = j;
                continue;
            }
            if (PY_OP_CHARS.indexOf(ch) !== -1) {
                let j = i + 1;
                while (j < n && j - i < 3 && PY_OP_CHARS.indexOf(code.charAt(j)) !== -1) j++;
                push(list, 'operator', code.slice(i, j));
                i = j;
                continue;
            }
            if (PY_PUNCT_CHARS.indexOf(ch) !== -1) {
                push(list, 'punct', ch);
                i += 1;
                continue;
            }
            push(list, '', ch);
            i += 1;
        }
        return list;
    }

    /* ---------- 汇编（x86 / RISC-V / GAS 通用写法） ---------- */

    const ASM_MNEMONICS = makeSet(
        // RISC-V
        'li la lla lw lh lb lbu lhu lwu sw sh sb sd ld add addi addw addiw sub subw and andi ' +
        'or ori xor xori sll slli srl srli sra srai slt slti sltu sltiu mul mulw div divw divu ' +
        'rem remu lui auipc jal jalr beq bne blt bge bltu bgeu beqz bnez blez bgez j jr ret call ' +
        'tail nop mv neg not seqz snez sltz sgtz fld fsw flw fadd fsub fmul fdiv csrr csrw csrs ' +
        'csrci ecall ebreak fence wfi amoswap amoadd ' +
        // x86 / x86-64
        'mov movq movl movw movb push pushq pop popq addq subq imul idiv cmp test lea leaq ' +
        'jmp je jne jz jnz jg jge jl jle ja jae jb jbe jc jnc loop int syscall leave enter xchg ' +
        'inc dec shl shr sal sar rol ror rep stos stosb movs cmps cld std setz sete setne bt bts ' +
        'btr bsf bsr cpuid rdtsc hlt ud2 xor and or not neg addl subl imull ' +
        // ARM / 通用伪指令
        'ldr str ldrb strb bx blx b bl beq bne bgt blt bge svc bkpt mrs msr tst teq'
    );
    const ASM_DIRECTIVES = makeSet(
        'text data bss rodata section align p2align balign byte short word long quad ascii ' +
        'asciiz asciz string space zero fill comm local globl global include macro endm equ set ' +
        'type size file ident option attribute extern weak end func previous pushsection popsection'
    );
    const ASM_REG_NAMES = makeSet(
        'zero ra sp gp tp fp pc s0 s1 flags rflags eflags rip rsp rbp rdi rsi rdx rcx rbx rax'
    );
    // 寄存器族（逐个试，返回值为结束下标；-1 表示不是寄存器）
    const RE_ASM_REGISTER = [
        /^%[A-Za-z0-9_]+/,                                        // x86 AT&T：%rax %rsp %al
        /^(?:[re]?[abcd]x|[re]?(?:si|di|sp|bp|ip)|[abcd][lh])(?![A-Za-z0-9_])/,
        /^r(?:[89]|1[0-5])[dwb]?(?![A-Za-z0-9_])/,                 // x86-64：r8 … r15d
        /^x(?:[0-9]|[12][0-9]|3[01])(?![A-Za-z0-9_])/,             // RISC-V x0 … x31
        /^r(?:[0-9]|[12][0-9]|3[01])(?![A-Za-z0-9_])/,             // 通用 r0 … r31
        /^a[0-7](?![A-Za-z0-9_])/,                                 // RISC-V 参数寄存器
        /^s(?:[0-9]|1[01])(?![A-Za-z0-9_])/,                       // RISC-V 保存寄存器
        /^t[0-6](?![A-Za-z0-9_])/,                                 // RISC-V 临时寄存器
        /^f(?:[0-9]|[12][0-9]|3[01])(?![A-Za-z0-9_])/,             // 浮点寄存器
        /^ft(?:[0-9]|1[01])(?![A-Za-z0-9_])/,
        /^fa[0-7](?![A-Za-z0-9_])/,
        /^fs(?:[0-9]|1[01])(?![A-Za-z0-9_])/
    ];
    const RE_ASM_NUMBER = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+)[uUlL]*/;
    const ASM_OP_CHARS = '+-*/%&|^~!<>=$';
    const ASM_PUNCT_CHARS = '(){}[],:';

    function scanAsmRegister(code, i) {
        const chunk = code.slice(i, i + 16);
        for (let k = 0; k < RE_ASM_REGISTER.length; k++) {
            const m = RE_ASM_REGISTER[k].exec(chunk);
            if (m && m[0].length > 0) return i + m[0].length;
        }
        return -1;
    }

    function tokenizeAsm(code) {
        const list = [];
        const n = code.length;
        let i = 0;
        // 行首、或标签之后：下一个「指令词」按助记符上色，这样即便
        // 遇到表里没登记的冷门助记符（各家扩展指令集）也不会漏掉
        let expectMnemonic = true;

        while (i < n) {
            const ch = code.charAt(i);
            const next = i + 1 < n ? code.charAt(i + 1) : '';

            if (isSpaceCh(ch)) {
                let j = i + 1;
                while (j < n && isSpaceCh(code.charAt(j))) j++;
                const ws = code.slice(i, j);
                push(list, '', ws);
                if (ws.indexOf('\n') !== -1) expectMnemonic = true;
                i = j;
                continue;
            }
            // 注释：; 与 // 吃到行尾
            if (ch === ';' || (ch === '/' && next === '/')) {
                const j = scanLineComment(code, i);
                push(list, 'comment', code.slice(i, j));
                i = j;
                continue;
            }
            // # 有两种身份：行首/空白之后的 # 是注释；
            // 紧跟数字的（如 ARM 的 #10）是立即数前缀
            if (ch === '#') {
                const prevBlank = i === 0 || isSpaceCh(code.charAt(i - 1));
                let j = i + 1;
                while (j < n && (code.charAt(j) === ' ' || code.charAt(j) === '\t')) j++;
                const c2 = code.charAt(j);
                const isImmediate = c2 === '-' || c2 === '+' || isDigit(c2);
                if (prevBlank && !isImmediate) {
                    const end = scanLineComment(code, i);
                    push(list, 'comment', code.slice(i, end));
                    i = end;
                    continue;
                }
                push(list, 'operator', '#');
                i += 1;
                continue;
            }
            // 字符串
            if (ch === '"' || ch === '\'') {
                const j = scanQuoted(code, i, ch, false);
                pushLiteral(list, code, i, j, 'string');
                expectMnemonic = false;
                i = j;
                continue;
            }
            // 数字局部标签（0: 1: …）与普通数字
            if (isDigit(ch)) {
                let j = i;
                while (j < n && isDigit(code.charAt(j))) j++;
                if (code.charAt(j) === ':') {
                    push(list, 'label', code.slice(i, j + 1));
                    expectMnemonic = true;
                    i = j + 1;
                    continue;
                }
                const end = matchBounded(RE_ASM_NUMBER, code, i);
                if (end > i) {
                    push(list, 'number', code.slice(i, end));
                    expectMnemonic = false;
                    i = end;
                    continue;
                }
            }
            // 点开头：.text / .globl 这类指示伪指令，或 .L1 这类本地符号/标签
            if (ch === '.' && isIdentStart(next)) {
                let j = i + 1;
                while (j < n && (isIdentChar(code.charAt(j)) || code.charAt(j) === '.' || code.charAt(j) === '$')) j++;
                const word = code.slice(i, j);
                if (code.charAt(j) === ':') {
                    push(list, 'label', word + ':');
                    expectMnemonic = true;
                    i = j + 1;
                    continue;
                }
                const bare = word.slice(1).toLowerCase();
                if (inSet(ASM_DIRECTIVES, bare)) {
                    push(list, 'directive', word);
                    expectMnemonic = false;
                } else {
                    push(list, 'label', word);
                    expectMnemonic = false;
                }
                i = j;
                continue;
            }
            // 寄存器（%rax 这种带前缀的先看）。
            // 注意 bl / bx 这类「在 x86 是寄存器、在 ARM 是指令」的名字：
            // 行首位置优先当助记符，操作数位置仍按寄存器上色
            const regEnd = scanAsmRegister(code, i);
            if (regEnd > i) {
                const regWord = code.slice(i, regEnd).toLowerCase();
                const asMnemonic = expectMnemonic && inSet(ASM_MNEMONICS, regWord);
                push(list, asMnemonic ? 'mnemonic' : 'register', code.slice(i, regEnd));
                expectMnemonic = false;
                i = regEnd;
                continue;
            }
            // 标识符：标签 → 寄存器名 → 助记符 → 行首兜底 → 普通文本
            if (isIdentStart(ch)) {
                const j = scanIdent(code, i);
                const word = code.slice(i, j);
                if (code.charAt(j) === ':') {
                    push(list, 'label', word + ':');
                    expectMnemonic = true;
                    i = j + 1;
                    continue;
                }
                const lower = word.toLowerCase();
                let type = '';
                if (inSet(ASM_REG_NAMES, lower)) type = 'register';
                else if (inSet(ASM_MNEMONICS, lower)) type = 'mnemonic';
                else if (expectMnemonic) type = 'mnemonic';
                push(list, type, word);
                expectMnemonic = false;
                i = j;
                continue;
            }
            // 运算符
            if (ASM_OP_CHARS.indexOf(ch) !== -1) {
                let j = i + 1;
                while (j < n && j - i < 3 && ASM_OP_CHARS.indexOf(code.charAt(j)) !== -1) j++;
                push(list, 'operator', code.slice(i, j));
                expectMnemonic = false;
                i = j;
                continue;
            }
            // 标点
            if (ASM_PUNCT_CHARS.indexOf(ch) !== -1) {
                push(list, 'punct', ch);
                expectMnemonic = false;
                i += 1;
                continue;
            }
            push(list, '', ch);
            expectMnemonic = false;
            i += 1;
        }
        return list;
    }

    /* ---------- Shell（bash / zsh / sh 通用写法） ---------- */

    const SH_KEYWORDS = makeSet(
        'if then else elif fi for while until do done case esac function select in time coproc'
    );
    const SH_FLOW = makeSet('return break continue exit shift trap');
    const SH_BUILTINS = makeSet(
        'echo printf read cd pwd export unset local declare typeset readonly source alias unalias ' +
        'set test eval exec exec command type hash builtin enable help history fc ulimit umask ' +
        'wait kill jobs fg bg disown pushd popd dirs mapfile readarray let logout '
    );
    const SH_CONSTANTS = makeSet('true false');
    const SH_OP_CHARS = '|&;<>=';

    // 判断 i 处的 # 是不是注释起点：行首，或前一个字符是空白/分隔符
    function isShellCommentStart(code, i) {
        if (i === 0) return true;
        const prev = code.charAt(i - 1);
        return isSpaceCh(prev) || prev === ';' || prev === '|' || prev === '&' ||
               prev === '(' || prev === ')' || prev === '{' || prev === '}';
    }

    // $ 变量：$NAME / ${…} / $1 / $@ / $? …；$() 命令替换按整段吃掉（内部不细分）
    // 返回结束下标；不是变量则返回 -1
    function scanShellVariable(code, i) {
        const n = code.length;
        const next = i + 1 < n ? code.charAt(i + 1) : '';
        if (next === '{') {
            const close = code.indexOf('}', i + 2);
            return close === -1 ? n : close + 1;
        }
        if (next === '(') {
            // 括号配对（粗略：跳过引号与转义，够高亮用；配不上就吃到末尾）
            let depth = 0;
            let j = i + 1;
            while (j < n) {
                const ch = code.charAt(j);
                if (ch === '\\') { j += 2; continue; }
                if (ch === '\'') { j = scanQuoted(code, j, '\'', false); continue; }
                if (ch === '"') { j = scanQuoted(code, j, '"', false); continue; }
                if (ch === '(') depth++;
                else if (ch === ')') { depth--; if (depth === 0) return j + 1; }
                j++;
            }
            return n;
        }
        if (next !== '' && /[A-Za-z0-9_@*#?$!\-]/.test(next)) {
            let j = i + 1;
            while (j < n && /[A-Za-z0-9_]/.test(code.charAt(j))) j++;
            return j;
        }
        return -1;
    }

    function tokenizeShell(code) {
        const list = [];
        const n = code.length;
        let i = 0;
        let cmdPos = true;     // 当前位置是否处于「命令名」位置（决定 command 是否高亮为函数）
        while (i < n) {
            const ch = code.charAt(i);
            const next = i + 1 < n ? code.charAt(i + 1) : '';

            if (isSpaceCh(ch)) {
                let j = i + 1;
                while (j < n && isSpaceCh(code.charAt(j))) j++;
                push(list, '', code.slice(i, j));
                if (code.slice(i, j).indexOf('\n') !== -1) cmdPos = true;
                i = j;
                continue;
            }
            // 行注释（只有词首的 # 才是注释；`$#`、`a#b` 不是）
            if (ch === '#' && isShellCommentStart(code, i)) {
                const j = scanLineComment(code, i);
                push(list, 'comment', code.slice(i, j));
                i = j;
                continue;
            }
            // $ 开头的字符串（$'…' / $"…"）与普通引号
            if (ch === '$' && (next === '\'' || next === '"')) {
                const end = scanQuoted(code, i + 1, next, false);
                pushLiteral(list, code, i, end, 'string');
                i = end;
                cmdPos = false;
                continue;
            }
            if (ch === '\'') {
                const end = scanQuoted(code, i, '\'', false);
                pushLiteral(list, code, i, end, 'string');
                i = end;
                cmdPos = false;
                continue;
            }
            if (ch === '"') {
                const end = scanQuoted(code, i, '"', false);
                pushLiteral(list, code, i, end, 'string');
                i = end;
                cmdPos = false;
                continue;
            }
            if (ch === '`') {
                const end = scanQuoted(code, i, '`', true);
                pushLiteral(list, code, i, end, 'string');
                i = end;
                cmdPos = false;
                continue;
            }
            if (ch === '$') {
                const end = scanShellVariable(code, i);
                if (end > i) {
                    push(list, 'variable', code.slice(i, end));
                    i = end;
                    cmdPos = false;
                    continue;
                }
            }
            // 反斜杠转义（含 \<换行> 续行）
            if (ch === '\\') {
                if (next === '\n') {
                    push(list, 'escape', code.slice(i, i + 2));
                    i += 2;
                    if (i < n && code.charAt(i) === '\r') { /* 不额外吞 \r */ }
                    cmdPos = false;
                    continue;
                }
                if (i + 1 < n) {
                    push(list, 'escape', code.slice(i, i + 2));
                    i += 2;
                    cmdPos = false;
                    continue;
                }
            }
            if (isDigit(ch)) {
                const end = matchBounded(/^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)/, code, i);
                if (end > i) {
                    push(list, 'number', code.slice(i, end));
                    i = end;
                    cmdPos = false;
                    continue;
                }
            }
            // 标识符 / 命令名 / 选项
            if (/[A-Za-z_./~@%-]/.test(ch)) {
                let j = i;
                while (j < n && /[A-Za-z0-9_./~@%+-]/.test(code.charAt(j))) j++;
                const word = code.slice(i, j);
                let type = '';
                if (word.charAt(0) === '-' && word.length > 1) {
                    type = 'parameter';            // 选项：-x / --long
                } else if (inSet(SH_CONSTANTS, word)) {
                    type = 'constant';
                } else if (inSet(SH_FLOW, word)) {
                    type = 'keyword-flow';
                } else if (inSet(SH_KEYWORDS, word)) {
                    type = 'keyword';
                } else if (cmdPos) {
                    type = 'function';             // 命令位置的词按命令着色
                } else if (inSet(SH_BUILTINS, word)) {
                    type = 'builtin';
                } else if (word.length > 1 && word.indexOf('/') !== -1) {
                    type = 'string';               // 路径
                }
                push(list, type, word);
                i = j;
                // 赋值语句（FOO=bar）不结束命令位置；if/then 这类关键字后面仍是命令位置
                if (code.charAt(j) === '=' && cmdPos && /^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) {
                    cmdPos = true;
                } else if (type === 'keyword' &&
                           /^(if|while|until|then|do|else|elif|time|!)$/.test(word)) {
                    cmdPos = true;
                } else {
                    cmdPos = false;
                }
                continue;
            }
            // 运算符（| & ; < > =），连续同族合并；2>&1 这种会拆成 number/operator/number
            if (SH_OP_CHARS.indexOf(ch) !== -1) {
                let j = i + 1;
                while (j < n && j - i < 3 && SH_OP_CHARS.indexOf(code.charAt(j)) !== -1) j++;
                const op = code.slice(i, j);
                push(list, 'operator', op);
                cmdPos = (op === '|' || op === '&' || op === ';' || op === '&&' || op === '||' || op === '|&');
                i = j;
                continue;
            }
            if ('(){}[],'.indexOf(ch) !== -1) {
                push(list, 'punct', ch);
                cmdPos = (ch === '(' || ch === '{');
                i += 1;
                continue;
            }
            push(list, '', ch);
            cmdPos = false;
            i += 1;
        }
        return list;
    }

    /* ---------- 渲染 ---------- */

    function renderTokens(tokens) {
        let html = '';
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            const type = (t && typeof t.type === 'string') ? t.type : '';
            const text = (t && typeof t.text === 'string') ? t.text : '';
            if (text === '') continue;
            // 词表外的 type 一律当纯文本，避免输出没人配色的类名
            if (type !== '' && TOKEN_TYPES[type] === 1) {
                html += '<span class="tok-' + type + '">' + escapeHtml(text) + '</span>';
            } else {
                html += escapeHtml(text);
            }
        }
        return html;
    }

    /* ---------- 对外 API ---------- */

    // 高亮：语言不认识返回 null；语言认识但内容为空返回 ''
    function highlight(code, lang) {
        const id = canonical(lang);
        if (id === null) return null;
        const src = typeof code === 'string' ? code : (code == null ? '' : String(code));
        if (src === '') return '';
        const def = LANGUAGES[id];
        if (!def) return escapeHtml(src);

        let tokens = null;
        try {
            tokens = def.tokenize(src);
        } catch (e) {
            return escapeHtml(src);          // tokenizer 出岔子也要能出页面
        }
        if (!tokens || typeof tokens.length !== 'number') return escapeHtml(src);

        // 完整性自校验：token 拼接必须和原文逐字节相等
        const clean = [];
        let joined = '';
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (!t || typeof t.text !== 'string') continue;
            joined += t.text;
            clean.push(t);
        }
        if (joined !== src) return escapeHtml(src);   // 对不上：宁可不高亮
        return renderTokens(clean);
    }

    // 别名 → 规范 id；不认识返回 null
    function canonical(lang) {
        if (typeof lang !== 'string') return null;
        let key = lang.trim().toLowerCase();
        if (key === '') return null;
        if (key.charAt(0) === '.') key = key.slice(1);   // 容忍 .c / .py 这种写法
        const id = ALIAS_MAP[key];
        return typeof id === 'string' ? id : null;
    }

    function has(lang) {
        return canonical(lang) !== null;
    }

    // 注册语言：def = { aliases: [], tokenize: function(code) { … } }
    function register(id, def) {
        if (typeof id !== 'string' || id === '') return false;
        if (!def || typeof def.tokenize !== 'function') return false;
        const key = id.trim().toLowerCase();
        if (key === '') return false;
        LANGUAGES[key] = { id: key, tokenize: def.tokenize };
        const aliases = (def.aliases && def.aliases.length) ? def.aliases : [key];
        for (let i = 0; i < aliases.length; i++) {
            const alias = String(aliases[i]).trim().toLowerCase();
            if (alias !== '') ALIAS_MAP[alias] = key;
        }
        ALIAS_MAP[key] = key;                // 规范 id 自己永远可查
        return true;
    }

    /* ---------- 内置语言注册（就是文件头注释里「三步走」的第 1、2 步） ---------- */
    register('c', {
        aliases: ['c', 'h', 'cpp', 'cxx', 'cc', 'hpp', 'hh', 'objc', 'c++'],
        tokenize: tokenizeC
    });
    register('python', {
        aliases: ['python', 'py', 'python3', 'py3'],
        tokenize: tokenizePython
    });
    register('asm', {
        aliases: ['asm', 'assembly', 'nasm', 'gas', 'att', 'x86', 'x86_64', 'x86-64',
                  'riscv', 'rv32', 'rv64', 'riscv32', 'riscv64', 's'],
        tokenize: tokenizeAsm
    });
    register('shell', {
        aliases: ['shell', 'sh', 'bash', 'zsh', 'ksh', 'fish', 'console', 'terminal',
                  'shellscript', 'sh-session', 'bash-session', 'zsh-session', 'cmdline'],
        tokenize: tokenizeShell
    });

    const api = {
        canonical: canonical,
        has: has,
        highlight: highlight,
        register: register,
        escapeHtml: escapeHtml,
        // 便于调试/自测：返回已登记的语言 id 与可用 token 词表
        languages: function() { return Object.keys(LANGUAGES); },
        tokenTypes: function() { return Object.keys(TOKEN_TYPES); }
    };

    if (typeof window !== 'undefined') window.LongwayHighlight = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})();
