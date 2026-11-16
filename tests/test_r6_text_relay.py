# -*- coding: utf-8 -*-
"""r6_text 글자 안전 시험 (plan.md 5절 r6_text 397~416행, 2.1 N6, 3절 C4·C5).

꼴(r5 와 같음):
- web/relay.js 를 부르는 JS 는 이 파일 안의 JS_SRC 글로 둔다. pytest 가 임시 폴더에 써서 node 로 돌린다.
  JS 는 **값만** 낸다(단언 없음). 기대값은 모두 아래 EXPECT 표(파이썬)에 있다. 값 하나 = pytest 테스트 하나.
- JS 가 낸 이름은 배열로 받아 겹침과 빠짐·남음을 따로 단언한다(test_names_unique·test_names_match).
- '지금 앱과 같은 글자'(기준 1, N6 64행)는 고치기 전 app.js(커밋 828bc42) 의 글틀을 아래 old_bubble·old_dot·old_line 에
  옮겨 적어 견준다: bubbleIcon 543~546행, dotIcon 551행, 한 줄 풍선 761행, esc 470행.
  app.js 는 integration 에서 바뀌므로 app.js 글자를 읽어 견주지 않는다(plan.md 24행: 끝까지 참인 것만).
- 기대값은 참조 구현(.orchestra/logs/ref_relay/relay.js 443~462행)으로 검산했다(.orchestra/logs/tests_r6_text.md).

갈린 판단(통과 기준 문장 밖)과 근거:
- 숫자 칸은 typeof 가 number 이고 유한할 때만 String(x): 402행 "유한한 **숫자**면 String(x), 아니면(글자 "3" 포함) ?".
  그래서 true·[3]·{}·-0(→"0")·2.5(→"2.5")·0.1+0.2(String 그대로) 를 둔다.
- tone·role 은 정확히 같은 글자일 때만(402행 "만"). ['good']·toString 이 'good' 인 객체는 == 로 견주면 통과하니 넣는다.
- dx 는 Math.round 뒤 0 이면 style 없음(402행 "0 이거나", 기준 4 의 -0.4). Math.round 는 반을 위로 올리므로
  2.5→3, -2.5→-2, -1.5→-1, -0.5→style 없음(파이썬 round·toFixed·trunc 와 갈린다).
- far·around 는 "참·거짓으로만 본다"(402행) = 참으로 보이는 값(1·'yes'·태그 글)이면 속성을 달고 그 값은 늘 "true".
  참조 구현 449·454행과 같다. 기준 3 의 dotHtml far:X 도 그래서 data-far="true".
- sub·top: sub 는 비어 있으면(빈 글·null·undefined) 칸 없음(403행, 고치기 전 글틀 546행 `sub ?` 과 같음),
  top 0 → "0"·false → "false"(esc 규칙 401행: null·undefined 만 빈 글).
- popupHtml: 건너뛰는 줄은 null·undefined·빈 글·false 넷뿐(406행) → 0·NaN·true·" " 는 남는다.
  배열이 아니면(배열 같은 객체 {length:1}·{b:..} 하나 포함) 빈 팝업(406행).
- lineHtml·dotHtml 은 글틀에 없는 칸(far·role·dx·sub·around)을 받아도 무시한다(404·405행 글틀).
- 입력을 고치지 않는다(C5): 얼린 입력으로 불러도 던지지 않는다(relay.js 는 "use strict", 178행).
"""
import collections
import json
from pathlib import Path

import pytest

from test_p0_node import run_node

HERE = Path(__file__).resolve().parent
X = "<img src=x onerror=alert(1)>"
XE = "&lt;img src=x onerror=alert(1)&gt;"


# ---------- 고치기 전 app.js 의 글틀(옮겨 적음) ----------
def esc_py(s):
    """app.js 470행 esc (글자에만 씀) + 401행의 null → ''."""
    if s is None:
        return ""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


def old_bubble(top, free, total, sub, tone, role, far, dx, around):
    """app.js 543~546행 bubbleIcon 의 html."""
    h = '<div class="mk" data-tone="%s"' % tone
    if role:
        h += ' data-role="%s"' % role
    if far:
        h += ' data-far="true"'
    if around:
        h += ' data-around="true"'
    if dx:
        h += ' style="margin-left:%spx"' % dx
    h += '><span class="mk-top">%s</span><b class="num">%s<i>/%s</i></b>' % (esc_py(top), free, total)
    if sub:
        h += '<span class="mk-sub">%s</span>' % esc_py(sub)
    return h + "</div>"


def old_dot(free, tone, far):
    """app.js 551행 dotIcon 의 html."""
    return '<div class="mk-dot num" data-tone="%s"%s>%s</div>' % (tone, ' data-far="true"' if far else "", free)


def old_line(top, free, total, tone):
    """app.js 761행 한 줄 풍선의 html(top 은 이미 고른 글)."""
    return ('<div class="mk mk-line" data-around="true" data-tone="%s"><span class="mk-top">%s</span>'
            '<b class="num">%s<i>/%s</i></b></div>' % (tone, esc_py(top), free, total))


def B(top="a", free=1, total=1, sub="", tone="good", role="", far=False, dx=0, around=False):
    return old_bubble(top, free, total, sub, tone, role, far, dx, around)


# 기준 1 의 다섯 입력(409행) + 속성이 모두 켜진 것·다른 조합 둘
OLD = {
    "bubble": [
        ["채비", 2, 3, "가나전기·다라전기", "good", "primary", False, -43, False],
        ["워터", 0, 4, "", "busy", "backup", True, 43, False],
        ["한국전력", 0, 1, "시그넷", "bad", "", False, 0, True],
        ["기흥", 5, 8, "", "good", "", True, 0, False],
        ["A&B \"c\" 'd'", 1, 1, "x<y>", "good", "", False, 0, True],
        ["모두", 3, 9, "마바전기", "busy", "primary", True, -12, True],
        ["가>나", 12, 40, "a'b", "bad", "backup", False, 7, True],
    ],
    "dot": [[3, "good", False], [0, "bad", True], [1, "busy", False]],
    "line": [["시그넷", 1, 2, "busy"], ["가나전기", 0, 3, "bad"], ["A&B<x>", 2, 2, "good"]],
}
LIT1 = ('<div class="mk" data-tone="good" data-role="primary" style="margin-left:-43px"><span class="mk-top">채비</span>'
        '<b class="num">2<i>/3</i></b><span class="mk-sub">가나전기·다라전기</span></div>')
LIT5 = ('<div class="mk" data-tone="good" data-around="true"><span class="mk-top">A&amp;B &quot;c&quot; &#39;d&#39;</span>'
        '<b class="num">1<i>/1</i></b><span class="mk-sub">x&lt;y&gt;</span></div>')
LIT2_LINE = ('<div class="mk mk-line" data-around="true" data-tone="busy"><span class="mk-top">시그넷</span>'
             '<b class="num">1<i>/2</i></b></div>')
LIT2_DOT = '<div class="mk-dot num" data-tone="bad" data-far="true">0</div>'
LIT3 = ('<div class="mk" data-tone="bad" data-around="true"><span class="mk-top">%s</span><b class="num">1<i>/2</i></b>'
        '<span class="mk-sub">%s</span></div>' % (XE, XE))
LIT4 = '<div class="mk" data-tone="good"><span class="mk-top">a</span><b class="num">?<i>/?</i></b></div>'
LIT_POP5 = ('<div class="mk-pop"><b>판교주차장</b><br>한국전력 · 충전기 가나전기<br>빈 급속 0 / 전체 1 · 고장·점검 1<br>'
            '최대 350kW · 391원/kWh(추정) · 2분 전 정보<br><b>1순위</b></div>')
LIT_POP6 = '<div class="mk-pop"><b>%s</b><br>%s &amp; co<br><b></b><br>5</div>' % (XE, XE)
POP0 = '<div class="mk-pop"></div>'
NO_BAD = {"<img": False, "<script": False, "onclick": False, "background": False}

EXPECT = {}


def E(name, want):
    assert name not in EXPECT, name
    EXPECT[name] = want


for _n in ("esc", "bubbleHtml", "lineHtml", "dotHtml", "popupHtml"):
    E("내보냄 " + _n, "function")

# ---------- 기준 1: 지금 앱과 같은 글자 ----------
for _i, _a in enumerate(OLD["bubble"]):
    E("같은 글자 풍선 %d" % (_i + 1), old_bubble(*_a))
for _i, _a in enumerate(OLD["dot"]):
    E("같은 글자 점 %d" % (_i + 1), old_dot(*_a))
for _i, _a in enumerate(OLD["line"]):
    E("같은 글자 한 줄 %d" % (_i + 1), old_line(*_a))
E("기준 1 첫째 글자", LIT1)
E("기준 1 다섯째 글자", LIT5)
E("풍선 칸 하나도 없음", '<div class="mk" data-tone="bad"><span class="mk-top"></span><b class="num">?<i>/?</i></b></div>')

# ---------- 기준 2 ----------
E("기준 2 lineHtml", LIT2_LINE)
E("기준 2 dotHtml far 참", LIT2_DOT)
E("기준 2 dotHtml far 거짓", '<div class="mk-dot num" data-tone="bad">0</div>')
E("lineHtml 다른 칸 무시", LIT2_LINE)
E("dotHtml 다른 칸 무시", LIT2_DOT)
E("dotHtml free 없음", '<div class="mk-dot num" data-tone="good">?</div>')

# ---------- 기준 3: 태그가 든 이름 ----------
E("기준 3 풍선", LIT3)
E("기준 3 풍선 금지 글자", NO_BAD)
E("기준 3 한 줄", old_line(X, "?", 1, "bad"))
E("기준 3 점", '<div class="mk-dot num" data-tone="bad" data-far="true">?</div>')
E("기준 3 한 줄·점 금지 글자", [NO_BAD, NO_BAD])
E("따옴표로 속성 깨기", B(top='"><img src=x>', sub="' onmouseover='x"))
E("tone 속성 깨기", [B(tone="bad"), old_line("a", 1, 1, "bad"), old_dot(1, "bad", False)])

# ---------- 기준 4: 숫자 칸·dx ----------
E("기준 4 숫자 칸", LIT4)
DX = {"1.4": 1, "1.5": 2, "-0.4": None, "0": None, "NaN": None, "'12'": None, "null": None, "Infinity": None,
      "-Infinity": None, "2.5": 3, "-2.5": -2, "-1.5": -1, "-0.5": None, "0.49": None, "-43": -43, "43.5": 44,
      "true": None, "[5]": None, "undefined": None, "-0": None}
for _k, _px in DX.items():
    E("dx " + _k, B(dx=_px))
NUM = {"0": "0", "3": "3", "-1": "-1", "2.5": "2.5", "-0": "0", "0.1+0.2": "0.30000000000000004", "'3'": "?",
       "'<b>1</b>'": "?", "NaN": "?", "Infinity": "?", "-Infinity": "?", "null": "?", "undefined": "?",
       "true": "?", "false": "?", "[3]": "?", "{}": "?"}
for _k, _c in NUM.items():
    E("숫자 칸 " + _k, [old_line("a", _c, _c, "good"), old_dot(_c, "good", False), B(free=_c, total=_c)])

# ---------- tone·role·far·around·sub·top ----------
TONE = {"good": "good", "busy": "busy", "bad": "bad", "Good": "bad", "' good'": "bad", "'good '": "bad",
        "goodx": "bad", "xbusy": "bad", "''": "bad", "undefined": "bad", "null": "bad", "1": "bad",
        "['good']": "bad", "toString good 객체": "bad", "X": "bad"}
for _k, _t in TONE.items():
    E("tone " + _k, [B(tone=_t), old_line("a", 1, 1, _t), old_dot(1, _t, False)])
ROLE = {"primary": "primary", "backup": "backup", "''": "", "Primary": "", "'primary '": "", "primaryx": "",
        "['backup']": "", "undefined": "", "true": "", "toString primary 객체": "", "따옴표 onclick": ""}
for _k, _r in ROLE.items():
    E("role " + _k, B(role=_r))
FLAG = {"true": True, "false": False, "undefined": False, "null": False, "0": False, "1": True, "''": False,
        "'yes'": True, "X": True}
for _k, _f in FLAG.items():
    E("far·around " + _k, [B(far=_f), B(around=_f), old_dot(1, "good", _f)])
SUB = {"''": "", "undefined": "", "null": "", "'0'": "0", "X": X, "'가·나'": "가·나"}
for _k, _s in SUB.items():
    E("sub " + _k, B(sub=_s))
TOP = {"0": "0", "null": "", "undefined": "", "X": X, "false": "false", "'a&amp;b'": "a&amp;b"}
for _k, _s in TOP.items():
    E("top " + _k, [B(top=_s), old_line(_s, 1, 1, "good")])

# ---------- 기준 7: esc ----------
ESC = {"X": XE, "A&B": "A&amp;B", "따옴표 둘": "&quot;&#39;", "null": "", "undefined": "", "0": "0",
       "12.5": "12.5", "&amp;": "&amp;amp;", "false": "false", "true": "true", "''": "",
       "<<>>": "&lt;&lt;&gt;&gt;", "a&b&c": "a&amp;b&amp;c", "가나·다": "가나·다", "배열": "&lt;a&gt;,1",
       "NaN": "NaN", "-0": "0", "줄바꿈": "a\nb"}
for _k, _v in ESC.items():
    E("esc " + _k, _v)

# ---------- 기준 5·6: popupHtml ----------
E("기준 5 팝업", LIT_POP5)
E("기준 6 팝업", LIT_POP6)
for _k in ("[]", "null", "'x'", "undefined", "5", "배열 같은 객체", "{b} 하나"):
    E("팝업 빈 " + _k, POP0)
E("팝업 빈 것만", POP0)
E("팝업 0 줄", '<div class="mk-pop">0</div>')
E("팝업 NaN 줄", '<div class="mk-pop">NaN</div>')
E("팝업 true 줄", '<div class="mk-pop">true</div>')
E("팝업 빈칸 한 칸", '<div class="mk-pop"> </div>')
E("팝업 br 글", '<div class="mk-pop">&lt;br&gt;</div>')
E("팝업 b 0", '<div class="mk-pop"><b>0</b></div>')
E("팝업 b undefined", '<div class="mk-pop"><b></b></div>')
E("팝업 b 태그", '<div class="mk-pop"><b>&lt;b&gt;x&lt;/b&gt;</b></div>')
E("팝업 가운데 빈 줄", '<div class="mk-pop"><b>a</b><br>b</div>')
E("팝업 한 번만 이스케이프", '<div class="mk-pop">&amp;amp;<br><b>&amp;lt;</b></div>')

# ---------- C5: 얼린 입력 ----------
E("얼린 입력", [LIT3, old_line(X, "?", 1, "bad"), '<div class="mk-dot num" data-tone="bad" data-far="true">?</div>',
                '<div class="mk-pop"><b>%s</b><br>a</div>' % XE])
E("입력 그대로", True)

# ---------- 기준 8: r5 와 이어서 ----------
E("r5 이어서 이름 그대로", [X, X])
E("r5 이어서 <img 없음", True)
E("r5 이어서 첫 풍선", B(top="환경부", sub=X, around=True))
E("r5 이어서 첫 한 줄", old_line(X, 1, 1, "good"))
E("r5 이어서 첫 팝업", '<div class="mk-pop"><b>%s</b><br>환경부 · 충전기 %s<br>빈 급속 1 / 전체 1</div>' % (XE, XE))


JS_SRC = r'''
"use strict";
const path = require("path");
const fs = require("fs");
const ROOT = path.join(HERE, "..");
let R = null, loadErr = "";
try { R = require(path.join(ROOT, "web", "relay.js")); } catch (e) { loadErr = String(e && e.message).slice(0, 200); }

const OUT = [];
const rep = (k, v) => (v === undefined ? "$undefined" : typeof v === "function" ? "$function" : typeof v === "symbol" ? "$symbol"
  : typeof v === "number" && !Number.isFinite(v) ? "$" + String(v) : v);
function enc(x) { const s = JSON.stringify(x, rep); return s === undefined ? "$undefined" : JSON.parse(s); }
const errOf = (e) => ({ $throw: { name: e && e.name, code: e && e.code, message: e && e.message } });
function put(name, f) { let v; try { v = enc(f()); } catch (e) { v = errOf(e); } OUT.push([name, v]); }
function fn(n) {
  if (!R || typeof R[n] !== "function") throw new Error(`relay.js 에 ${n} 함수가 없음 ${loadErr}`);
  return R[n];
}
const BH = (o) => fn("bubbleHtml")(o), LH = (o) => fn("lineHtml")(o), DH = (o) => fn("dotHtml")(o);
const PH = (l) => fn("popupHtml")(l), ESC = (s) => fn("esc")(s);
const X = "<img src=x onerror=alert(1)>";
const strObj = (s) => ({ toString() { return s; }, valueOf() { return s; } });

for (const n of ["esc", "bubbleHtml", "lineHtml", "dotHtml", "popupHtml"]) put(`내보냄 ${n}`, () => (R ? typeof R[n] : "relay.js 못 읽음 " + loadErr));

// ---------- 기준 1: 지금 앱과 같은 글자 ----------
const objOf = (a) => ({ top: a[0], free: a[1], total: a[2], sub: a[3], tone: a[4], role: a[5], far: a[6], dx: a[7], around: a[8] });
OLD.bubble.forEach((a, i) => put(`같은 글자 풍선 ${i + 1}`, () => BH(objOf(a))));
OLD.dot.forEach((a, i) => put(`같은 글자 점 ${i + 1}`, () => DH({ free: a[0], tone: a[1], far: a[2] })));
OLD.line.forEach((a, i) => put(`같은 글자 한 줄 ${i + 1}`, () => LH({ top: a[0], free: a[1], total: a[2], tone: a[3] })));
put("기준 1 첫째 글자", () => BH({ top: "채비", free: 2, total: 3, sub: "가나전기·다라전기", tone: "good", role: "primary", far: false, dx: -43, around: false }));
put("기준 1 다섯째 글자", () => BH({ top: "A&B \"c\" 'd'", free: 1, total: 1, sub: "x<y>", tone: "good", role: "", far: false, dx: 0, around: true }));
put("풍선 칸 하나도 없음", () => BH({}));

// ---------- 기준 2 ----------
put("기준 2 lineHtml", () => LH({ top: "시그넷", free: 1, total: 2, tone: "busy" }));
put("기준 2 dotHtml far 참", () => DH({ free: 0, tone: "bad", far: true }));
put("기준 2 dotHtml far 거짓", () => DH({ free: 0, tone: "bad", far: false }));
put("lineHtml 다른 칸 무시", () => LH({ top: "시그넷", free: 1, total: 2, tone: "busy", far: true, role: "primary", dx: 5, sub: "x", around: false }));
put("dotHtml 다른 칸 무시", () => DH({ free: 0, tone: "bad", far: true, top: "x", total: 9, role: "primary", dx: 5, sub: "y", around: false }));
put("dotHtml free 없음", () => DH({ tone: "good" }));

// ---------- 기준 3: 태그가 든 이름 ----------
const ATTACK = () => ({ top: X, free: 1, total: 2, sub: X, tone: '"><script>', role: '" onclick="x', far: false, dx: "1;background:url(x)", around: true });
const LATT = () => ({ top: X, free: X, total: 1, tone: X });
const DATT = () => ({ free: X, tone: X, far: X });
const bad = (s) => ({ "<img": s.includes("<img"), "<script": s.includes("<script"), onclick: s.includes("onclick"), background: s.includes("background") });
put("기준 3 풍선", () => BH(ATTACK()));
put("기준 3 풍선 금지 글자", () => bad(BH(ATTACK())));
put("기준 3 한 줄", () => LH(LATT()));
put("기준 3 점", () => DH(DATT()));
put("기준 3 한 줄·점 금지 글자", () => [bad(LH(LATT())), bad(DH(DATT()))]);
put("따옴표로 속성 깨기", () => BH({ top: '"><img src=x>', free: 1, total: 1, sub: "' onmouseover='x", tone: "good" }));
{
  const t = 'good" onclick="x';
  put("tone 속성 깨기", () => [BH({ top: "a", free: 1, total: 1, tone: t }), LH({ top: "a", free: 1, total: 1, tone: t }), DH({ free: 1, tone: t })]);
}

// ---------- 기준 4: 숫자 칸·dx ----------
put("기준 4 숫자 칸", () => BH({ top: "a", free: "<b>1</b>", total: NaN, tone: "good" }));
const DX = [["1.4", 1.4], ["1.5", 1.5], ["-0.4", -0.4], ["0", 0], ["NaN", NaN], ["'12'", "12"], ["null", null], ["Infinity", Infinity],
  ["-Infinity", -Infinity], ["2.5", 2.5], ["-2.5", -2.5], ["-1.5", -1.5], ["-0.5", -0.5], ["0.49", 0.49], ["-43", -43], ["43.5", 43.5],
  ["true", true], ["[5]", [5]], ["undefined", undefined], ["-0", -0]];
for (const [k, v] of DX) put("dx " + k, () => BH({ top: "a", free: 1, total: 1, tone: "good", dx: v }));
const NUM = [["0", 0], ["3", 3], ["-1", -1], ["2.5", 2.5], ["-0", -0], ["0.1+0.2", 0.1 + 0.2], ["'3'", "3"], ["'<b>1</b>'", "<b>1</b>"],
  ["NaN", NaN], ["Infinity", Infinity], ["-Infinity", -Infinity], ["null", null], ["undefined", undefined], ["true", true],
  ["false", false], ["[3]", [3]], ["{}", {}]];
for (const [k, v] of NUM) put("숫자 칸 " + k, () => [LH({ top: "a", free: v, total: v, tone: "good" }), DH({ free: v, tone: "good" }), BH({ top: "a", free: v, total: v, tone: "good" })]);

// ---------- tone·role·far·around·sub·top ----------
const TONE = [["good", "good"], ["busy", "busy"], ["bad", "bad"], ["Good", "Good"], ["' good'", " good"], ["'good '", "good "],
  ["goodx", "goodx"], ["xbusy", "xbusy"], ["''", ""], ["undefined", undefined], ["null", null], ["1", 1], ["['good']", ["good"]],
  ["toString good 객체", strObj("good")], ["X", X]];
for (const [k, t] of TONE) put("tone " + k, () => [BH({ top: "a", free: 1, total: 1, tone: t }), LH({ top: "a", free: 1, total: 1, tone: t }), DH({ free: 1, tone: t })]);
const ROLE = [["primary", "primary"], ["backup", "backup"], ["''", ""], ["Primary", "Primary"], ["'primary '", "primary "],
  ["primaryx", "primaryx"], ["['backup']", ["backup"]], ["undefined", undefined], ["true", true],
  ["toString primary 객체", strObj("primary")], ["따옴표 onclick", 'primary" onclick="x']];
for (const [k, r] of ROLE) put("role " + k, () => BH({ top: "a", free: 1, total: 1, tone: "good", role: r }));
const FLAG = [["true", true], ["false", false], ["undefined", undefined], ["null", null], ["0", 0], ["1", 1], ["''", ""], ["'yes'", "yes"], ["X", X]];
for (const [k, f] of FLAG) put("far·around " + k, () => [BH({ top: "a", free: 1, total: 1, tone: "good", far: f }), BH({ top: "a", free: 1, total: 1, tone: "good", around: f }), DH({ free: 1, tone: "good", far: f })]);
const SUB = [["''", ""], ["undefined", undefined], ["null", null], ["'0'", "0"], ["X", X], ["'가·나'", "가·나"]];
for (const [k, s] of SUB) put("sub " + k, () => BH({ top: "a", free: 1, total: 1, tone: "good", sub: s }));
const TOP = [["0", 0], ["null", null], ["undefined", undefined], ["X", X], ["false", false], ["'a&amp;b'", "a&amp;b"]];
for (const [k, s] of TOP) put("top " + k, () => [BH({ top: s, free: 1, total: 1, tone: "good" }), LH({ top: s, free: 1, total: 1, tone: "good" })]);

// ---------- 기준 7: esc ----------
const ESCS = [["X", X], ["A&B", "A&B"], ["따옴표 둘", "\"'"], ["null", null], ["undefined", undefined], ["0", 0], ["12.5", 12.5],
  ["&amp;", "&amp;"], ["false", false], ["true", true], ["''", ""], ["<<>>", "<<>>"], ["a&b&c", "a&b&c"], ["가나·다", "가나·다"],
  ["배열", ["<a>", 1]], ["NaN", NaN], ["-0", -0], ["줄바꿈", "a\nb"]];
for (const [k, s] of ESCS) put("esc " + k, () => ESC(s));

// ---------- 기준 5·6: popupHtml ----------
put("기준 5 팝업", () => PH([{ b: "판교주차장" }, "한국전력 · 충전기 가나전기", "빈 급속 0 / 전체 1 · 고장·점검 1", "최대 350kW · 391원/kWh(추정) · 2분 전 정보", "", null, { b: "1순위" }]));
put("기준 6 팝업", () => PH([{ b: X }, X + " & co", { b: null }, 5, undefined, false]));
const EMPTY = [["[]", []], ["null", null], ["'x'", "x"], ["undefined", undefined], ["5", 5], ["배열 같은 객체", { length: 1, 0: "a" }], ["{b} 하나", { b: "a" }]];
for (const [k, l] of EMPTY) put("팝업 빈 " + k, () => PH(l));
put("팝업 빈 것만", () => PH(["", null, false, undefined]));
put("팝업 0 줄", () => PH([0]));
put("팝업 NaN 줄", () => PH([NaN]));
put("팝업 true 줄", () => PH([true]));
put("팝업 빈칸 한 칸", () => PH([" "]));
put("팝업 br 글", () => PH(["<br>"]));
put("팝업 b 0", () => PH([{ b: 0 }]));
put("팝업 b undefined", () => PH([{ b: undefined }]));
put("팝업 b 태그", () => PH([{ b: "<b>x</b>" }]));
put("팝업 가운데 빈 줄", () => PH([{ b: "a" }, "", null, undefined, false, "b"]));
put("팝업 한 번만 이스케이프", () => PH(["&amp;", { b: "&lt;" }]));

// ---------- C5: 얼린 입력·입력 그대로 ----------
put("얼린 입력", () => [BH(Object.freeze(ATTACK())), LH(Object.freeze(LATT())), DH(Object.freeze(DATT())),
  PH(Object.freeze([Object.freeze({ b: X }), "a"]))]);
put("입력 그대로", () => {
  const o = ATTACK(), l = [{ b: X }, "", null, "a"], before = JSON.stringify([o, l]);
  BH(o); LH(o); DH(o); PH(l);
  return JSON.stringify([o, l]) === before && l.length === 4;
});

// ---------- 기준 8: r5 와 이어서 ----------
const NOW0 = 1767571920000;
const TARIFF = { default: 391, "환경부": 347 };
const SAMPLE = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, "ref", "relay_sample", p), "utf8"));
// parse… 결과 모양(plan.md 308·310행) — r5 시험과 같은 꼴
const PST = (doc) => ({ v: 1, zscode: doc.zscode, zcodes: doc.zcodes, stations: doc.stations.map((s) => Object.assign({ id: s.id, name: s.name, operator: s.operator, maker: s.maker, loc: s.loc, chargers: s.chargers.map((c) => ({ id: c.id, type: c.type, kw: c.kw })) }, s.indoor === true ? { indoor: true } : {})) });
const PSA = (doc) => { const s = Object.create(null); for (const [k, v] of Object.entries(doc.s)) { s[k] = Object.create(null); for (const [c, a] of Object.entries(v)) s[k][c] = Array.isArray(a) ? a[0] : a; } return { at: doc.at, s }; };
const PMETA = (m) => ({ v: 1, at: m.at, ok: m.ok, error: m.error || "", suspect: m.suspect || [], fresh: m.fresh || [] });
{
  let list = null, htmls = [], err = null;
  try {
    const d = PST(SAMPLE("stations/41135.json"));
    d.stations[0].name = X; d.stations[0].maker = X; d.stations[1].name = X;
    list = fn("regionStations")(d, PSA(SAMPLE("status/41135.json")), PMETA(SAMPLE("meta.json")), { now: NOW0, tariffs: TARIFF });
    for (const st of list) {
      const fast = st.chargers.filter((c) => c.type === "fast"), free = fast.filter((c) => c.status === "available").length;
      htmls.push(BH({ top: st.operator, free, total: fast.length, sub: st.maker, tone: free ? "good" : "bad", around: true }));
      htmls.push(LH({ top: String(st.maker).split("·")[0], free, total: fast.length, tone: free ? "good" : "bad" }));
      htmls.push(PH([{ b: st.name }, `${st.operator} · 충전기 ${st.maker}`, `빈 급속 ${free} / 전체 ${fast.length}`]));
    }
  } catch (e) { err = e; }
  const g = (f) => () => { if (err) throw err; return f(); };
  put("r5 이어서 이름 그대로", g(() => list.map((s) => s.name)));
  put("r5 이어서 <img 없음", g(() => htmls.length === 6 && htmls.every((h) => typeof h === "string" && !h.includes("<img"))));
  put("r5 이어서 첫 풍선", g(() => htmls[0]));
  put("r5 이어서 첫 한 줄", g(() => htmls[1]));
  put("r5 이어서 첫 팝업", g(() => htmls[2]));
}

console.log("VALUES " + JSON.stringify(OUT));
'''


@pytest.fixture(scope="module")
def emitted(tmp_path_factory):
    """JS_SRC 를 임시 폴더에 써서 node 로 돌리고 [이름, 값] 배열을 그대로(겹친 이름도 지우지 않고) 준다."""
    d = tmp_path_factory.mktemp("r6js")
    p = d / "r6_text_values.js"
    head = "const HERE = %s;\nconst OLD = %s;\n" % (json.dumps(str(HERE)), json.dumps(OLD, ensure_ascii=False))
    p.write_text(head + JS_SRC, encoding="utf-8")
    code, out, err = run_node([p], cwd=HERE)
    lines = [ln for ln in out.splitlines() if ln.startswith("VALUES ")]
    assert code == 0 and lines, "node 가 값을 내지 못함(exit %d)\n%s\n%s" % (code, out[-1500:], err[-2000:])
    pairs = json.loads(lines[-1][len("VALUES "):])
    assert isinstance(pairs, list) and all(isinstance(x, list) and len(x) == 2 for x in pairs)
    return pairs


def _dump(x):
    return json.dumps(x, ensure_ascii=False, sort_keys=True)


@pytest.mark.parametrize("name", list(EXPECT))
def test_value(emitted, name):
    got = dict(emitted)
    assert name in got, "JS 가 이 값을 내지 않음: %s" % name
    want = EXPECT[name]
    assert _dump(got[name]) == _dump(want), "%s\n받은 값 %s\n기대   %s" % (name, _dump(got[name]), _dump(want))


def test_names_unique(emitted):
    """JS 가 같은 이름을 두 번 내면 실패한다(뒤 값이 앞의 실패를 덮지 못하게). dict 로 바꾸기 전 배열로 센다."""
    dup = [n for n, c in collections.Counter(n for n, _ in emitted).items() if c > 1]
    assert dup == []


def test_names_match(emitted):
    """JS 가 낸 이름 집합 == EXPECT 이름 집합(조용히 건너뛴 값을 잡는다)."""
    names = [n for n, _ in emitted]
    assert sorted(set(names) - set(EXPECT)) == []
    assert sorted(set(EXPECT) - set(names)) == []


def test_old_template_matches_plan_literals():
    """자기 검사: 옮겨 적은 고치기 전 글틀이 계획서에 글자로 적힌 결과(409·410행)와 같다."""
    assert old_bubble(*OLD["bubble"][0]) == LIT1
    assert old_bubble(*OLD["bubble"][4]) == LIT5
    assert old_line(*OLD["line"][0]) == LIT2_LINE
    assert old_dot(0, "bad", True) == LIT2_DOT
    assert B(top=X, free=1, total=2, sub=X, tone="bad", around=True) == LIT3
    for s in (LIT3, LIT_POP6, EXPECT["기준 3 한 줄"], EXPECT["기준 3 점"]):
        assert "<img" not in s and "<script" not in s


def test_expect_strings_are_not_double_escaped():
    """자기 검사: 기대값의 esc 는 한 번뿐(&amp;amp; 는 입력에 &amp; 가 있을 때만)."""
    assert esc_py("A&B") == "A&amp;B" and esc_py(X) == XE and esc_py(None) == ""
    for name, want in EXPECT.items():
        if isinstance(want, str) and "&amp;amp;" in want:
            assert name in ("esc &amp;", "팝업 한 번만 이스케이프"), name
    assert "&amp;amp;" in EXPECT["top 'a&amp;b'"][0]
