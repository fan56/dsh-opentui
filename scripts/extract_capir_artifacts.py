#!/usr/bin/env python3
"""dsh-opentui 0.25 波2 W2-0a — CapIR 工件提取器（只读，标准库，v2）。

v1（0.24 首日）从本机宿主 clone 的 Typert 生成工件提取计数与 CapIR 雏形；
v2（本刀）在**同一批工件**上追加参数表双源解析，供 W2-0b CapIR v3 regen 使用：

  - `.d.ts` 的 `TYPERT_REMOTE` 字面量：参数字段名（wire 名）、顺序、可选性（`?`）权威；
  - `typert.host.js` 的 `createTypertRemoteInfo({...})` manifest：service /
    implementation / 每参 JSON Schema + typeSymbol / result JSON Schema /
    mode:'stream' / cancellation / scope。

双源交叉（fail-loud）：
  逐方法 `.d.ts` 参数名序列 == manifest 参数 wire 名序列（`wire ?? name`），
  可选性序列一致，service 非空；任一不一致 → 整脚本退出码 1、不产出任何输出文件。
  依据方案 §0.1 wire 规则 `wire = parameter.wire ?? parameter.name`
  （宿主 typert/protocol/src/remote-info.ts:50）。manifest 的 lookup 逻辑名
  （agent / session / workspaceFileScope）与 `.d.ts` 的 wire 名（agentId /
  sessionId / workspaceFileScopeId）靠 wire 字段消歧，非不一致。

类型归一档：`string | boolean | number | object | array | union`；顶层 `enum`
无论归一类型均附 `enum: [...]`（枚举收割，BAD_PARAMS 可判）；`oneOf`/`anyOf`
归 `union`；无/空 jsonSchema 走 `.d.ts` token 兜底（2 条，报告中如实记录）。
深层结构不归一，jsonSchema 逐字保留（键序与 manifest 原文一致）。

确定性：双跑字节一致（标准 json.dumps 保序；无时间/环境字段）。

用法：
  python3 -I extract_capir_artifacts.py <宿主clone根> <输出JSON路径> [输出Markdown清单路径] [--crosscheck <双源交叉报告路径>]

仅使用标准库；对宿主 clone 只读；无 git 动作、无网络、无凭据值落盘。
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

# --- 计数口径正则（v1 保留，逐字） ---
RE_METHOD_DTS = re.compile(r"^\s*readonly '([^']+)': TypertRemoteMethod<(.+)$", re.M)
RE_STREAM_MARK = re.compile(r"'stream'")
RE_MAP_KEYS = re.compile(r"^\s*'([^']+)':", re.M)
RE_JS_METHOD = re.compile(r"^    '([^']+)': \{$", re.M)
RE_PKG_NAME = re.compile(r'"name"\s*:\s*"([^"]+)"')


# --- 通用括号/字符串配平（v2） ---
def extract_balanced(text, start, op, cl):
    """start 指向 op 字符；返回 (内部文本, 匹配 cl 之后的下标)。跳过字符串字面量。"""
    if start >= len(text) or text[start] != op:
        raise ValueError("extract_balanced: start is not " + op)
    depth = 0
    i = start
    instr = None
    esc = False
    while i < len(text):
        c = text[i]
        if instr:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == instr:
                instr = None
            i += 1
            continue
        if c in "'\"`":
            instr = c
        elif c == op:
            depth += 1
        elif c == cl:
            depth -= 1
            if depth == 0:
                return text[start + 1:i], i + 1
        i += 1
    raise ValueError("extract_balanced: unbalanced " + op + cl)


def split_top_level(text, sep=";"):
    """按 sep 在括号/字符串之外切分（保留嵌套对象类型）。"""
    out = []
    cur = []
    depth = 0
    instr = None
    esc = False
    for c in text:
        if instr:
            cur.append(c)
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == instr:
                instr = None
            continue
        if c in "'\"`":
            instr = c
            cur.append(c)
        elif c in "([{":
            depth += 1
            cur.append(c)
        elif c in ")]}":
            depth -= 1
            cur.append(c)
        elif c == sep and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(c)
    if cur:
        out.append("".join(cur))
    return out


class JSParser:
    """最小 JS 对象字面量解析器：支持对象/数组/字符串/数字/布尔/null/裸标识符与箭头函数表达式。

    jsonSchema 是纯 JSON 字面量子集，解析为保序 dict（键序与 manifest 原文一致）。
    裸引用（如 create: _x$schema）与箭头函数（decode/encode）收敛为 ('__IDENT__', 文本)，
    本提取器不使用其值。
    """

    def __init__(self, s):
        self.s = s
        self.i = 0
        self.n = len(s)

    def ws(self):
        while self.i < self.n and self.s[self.i] in " \t\r\n":
            self.i += 1

    def parse(self):
        self.ws()
        return self.value()

    def value(self):
        self.ws()
        if self.i >= self.n:
            raise ValueError("JSParser: unexpected EOF in value")
        c = self.s[self.i]
        if c == "{":
            return self.obj()
        if c == "[":
            return self.arr()
        if c in "'\"`":
            return self.string()
        # number / bare identifier / true/false/null / expression (arrow fn)
        start = self.i
        depth = 0
        instr = None
        esc = False
        while self.i < self.n:
            ch = self.s[self.i]
            if instr:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == instr:
                    instr = None
                self.i += 1
                continue
            if ch in "'\"`":
                instr = ch
            elif ch in "([{":
                depth += 1
            elif ch in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif ch == "," and depth == 0:
                break
            self.i += 1
        tok = self.s[start:self.i].strip()
        if tok == "true":
            return True
        if tok == "false":
            return False
        if tok == "null":
            return None
        if re.fullmatch(r"-?\d+(\.\d+)?", tok):
            return float(tok) if "." in tok else int(tok)
        return ("__IDENT__", tok)

    def string(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while self.i < self.n:
            c = self.s[self.i]
            if c == "\\":
                out.append(self.s[self.i:self.i + 2])
                self.i += 2
            elif c == q:
                self.i += 1
                break
            else:
                out.append(c)
                self.i += 1
        raw = "".join(out)
        try:
            return json.loads('"' + raw.replace('"', '\\"') + '"')
        except Exception:
            return raw.replace("\\'", "'").replace('\\"', '"')

    def obj(self):
        if self.s[self.i] != "{":
            raise ValueError("JSParser: expected {")
        self.i += 1
        d = {}
        while True:
            self.ws()
            if self.i >= self.n:
                raise ValueError("JSParser: unexpected EOF in object")
            if self.s[self.i] == "}":
                self.i += 1
                break
            c = self.s[self.i]
            if c in "'\"`":
                k = self.string()
            else:
                start = self.i
                while self.i < self.n and self.s[self.i] != ":":
                    self.i += 1
                k = self.s[start:self.i].strip()
            self.ws()
            if self.i < self.n and self.s[self.i] == ":":
                self.i += 1
            v = self.value()
            d[k] = v
            self.ws()
            if self.i < self.n and self.s[self.i] == ",":
                self.i += 1
        return d

    def arr(self):
        if self.s[self.i] != "[":
            raise ValueError("JSParser: expected [")
        self.i += 1
        a = []
        while True:
            self.ws()
            if self.i >= self.n:
                raise ValueError("JSParser: unexpected EOF in array")
            if self.s[self.i] == "]":
                self.i += 1
                break
            a.append(self.value())
            self.ws()
            if self.i < self.n and self.s[self.i] == ",":
                self.i += 1
        return a


# --- v1 保序函数 ---
def block_keys(text, marker):
    start = text.find("interface " + marker + " {")
    if start < 0:
        return []
    brace = text.find("{", start)
    depth = 0
    end = brace
    for i in range(brace, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    return RE_MAP_KEYS.findall(text[brace + 1:end])


# --- v2：.d.ts TYPERT_REMOTE 参数解析（字段名/序/可选性/token 权威） ---
def parse_dts_params(dtext):
    marker = "export declare const TYPERT_REMOTE: TypertRemoteInfo<{"
    idx = dtext.find(marker)
    if idx < 0:
        raise ValueError("TYPERT_REMOTE block not found in .d.ts")
    inner_start = idx + len(marker) - 1  # '{'
    inner, _ = extract_balanced(dtext, inner_start, "{", "}")
    out = {}
    for m in re.finditer(r"readonly\s+'([^']+)':\s*TypertRemoteMethod<", inner):
        key = m.group(1)
        pstart = inner.find("{", m.end())
        pinner, _ = extract_balanced(inner, pstart, "{", "}")
        names, optional, tokens = [], [], []
        for seg in split_top_level(pinner, ";"):
            pm = re.search(r"readonly\s+'([^']+)'(\?)?\s*:\s*(.*)", seg, re.S)
            if pm:
                names.append(pm.group(1))
                optional.append(bool(pm.group(2)))
                tokens.append(" ".join(pm.group(3).split()))
        out[key] = {"names": names, "optional": optional, "tokens": tokens}
    return out


# --- v2：typert.host.js manifest 解析 ---
def parse_manifest(jtext):
    idx = jtext.find("createTypertRemoteInfo(")
    if idx < 0:
        raise ValueError("createTypertRemoteInfo not found in typert.host.js")
    arg_start = jtext.find("{", idx)
    inner, _ = extract_balanced(jtext, arg_start, "{", "}")
    obj = JSParser("{" + inner + "}").parse()
    methods = obj.get("methods")
    if not isinstance(methods, dict):
        raise ValueError("manifest has no methods{}")
    out = {}
    for key, mo in methods.items():
        if not isinstance(mo, dict):
            continue
        rows = []
        for prm in mo.get("parameters", []):
            if not isinstance(prm, dict):
                continue
            codec = prm.get("codec") if isinstance(prm.get("codec"), dict) else {}
            rows.append({
                "name": prm.get("name"),
                "wire": prm.get("wire") or prm.get("name"),
                "source": prm.get("source"),
                "acceptsUndefined": bool(prm.get("acceptsUndefined")),
                "typeSymbol": codec.get("typeSymbol"),
                "jsonSchema": codec.get("jsonSchema") if isinstance(codec.get("jsonSchema"), dict) else None,
            })
        result = mo.get("result") if isinstance(mo.get("result"), dict) else {}
        out[key] = {
            "service": mo.get("service"),
            "implementation": mo.get("implementation"),
            "mode": mo.get("mode"),
            "scope": mo.get("scope") if isinstance(mo.get("scope"), dict) else None,
            "cancel": mo.get("cancellation", {}).get("parameter") if isinstance(mo.get("cancellation"), dict) else None,
            "params": rows,
            "result": {
                "typeSymbol": result.get("typeSymbol"),
                "jsonSchema": result.get("jsonSchema") if isinstance(result.get("jsonSchema"), dict) else None,
            },
        }
    return out


# --- v2：类型归一 + 双源交叉 ---
def normalize_type(js, token):
    if isinstance(js, dict):
        if js.get("type") in ("string", "boolean", "number", "object", "array"):
            return js["type"]
        if "oneOf" in js or "anyOf" in js:
            return "union"
        if "enum" in js:
            return "union"
    t = (token or "").strip()
    if t == "string":
        return "string"
    if t == "boolean":
        return "boolean"
    if t in ("number", "integer"):
        return "number"
    if t.endswith("[]") or t.startswith("readonly "):
        return "array"
    return "object"  # 确定性兜底（ProductEvent/JsonValue 等命名类型）


def cross_check_method(key, dts, man):
    """返回 (方法 v2 字段 dict, 交叉结果 dict)；不一致抛 ValueError（fail-loud）。"""
    dn = dts["names"]
    mn = [p["wire"] for p in man["params"]]
    do = dts["optional"]
    mo = [p["acceptsUndefined"] for p in man["params"]]
    if dn != mn:
        raise ValueError("dual-source name/order mismatch for %s: dts=%r manifest-wire=%r" % (key, dn, mn))
    if do != mo:
        raise ValueError("dual-source optionality mismatch for %s: dts=%r manifest=%r" % (key, do, mo))
    service = man["service"]
    if not isinstance(service, str) or not service:
        raise ValueError("missing service for " + key)
    params = []
    for i, name in enumerate(dn):
        p = man["params"][i]
        js = p["jsonSchema"]
        row = {
            "name": name,
            "required": not do[i],
            "type": normalize_type(js, dts["tokens"][i] if i < len(dts["tokens"]) else ""),
        }
        if p["typeSymbol"]:
            row["typeSymbol"] = p["typeSymbol"]
        if isinstance(js, dict) and isinstance(js.get("enum"), list):
            row["enum"] = js["enum"]
        row["jsonSchema"] = js  # None 表示该参数无/不可解析 schema（如实记录）
        params.append(row)
    fields = {"service": service, "params": params}
    impl = man["implementation"]
    if isinstance(impl, str) and impl and impl != key.partition("/")[2]:
        fields["implementation"] = impl
    if man["mode"] == "stream":
        fields["stream"] = True
    if man["cancel"]:
        fields["cancel"] = man["cancel"]
    if man["scope"]:
        fields["scope"] = man["scope"]
    result = {"jsonSchema": man["result"]["jsonSchema"]}
    if man["result"]["typeSymbol"]:
        result["typeSymbol"] = man["result"]["typeSymbol"]
    fields["result"] = result
    fb_rows = []
    for i in range(len(dn)):
        js = man["params"][i]["jsonSchema"]
        if js is None or js == {}:
            fb_rows.append({
                "param": dn[i],
                "token": dts["tokens"][i] if i < len(dts["tokens"]) else "",
                "type": params[i]["type"],
            })
    result_info = {
        "key": key,
        "param_count": len(params),
        "all_match": True,
        "type_fallback": fb_rows,
    }
    return fields, result_info


def parse_artifact(js, root):
    dts = js.parent / "typert.remote-client.d.ts"
    hj = js.parent / "typert.host.js"

    dtext = dts.read_text(encoding="utf-8")
    jtext = js.read_text(encoding="utf-8")
    if not hj.exists():
        raise ValueError("typert.host.js missing alongside " + str(js))

    m = RE_PKG_NAME.search(jtext)
    pkg = m.group(1) if m else ""
    if not pkg:
        pj = js.parent.parent / "package.json"
        if pj.exists():
            m2 = RE_PKG_NAME.search(pj.read_text(encoding="utf-8"))
            pkg = m2.group(1) if m2 else ""

    dts_params = parse_dts_params(dtext)
    manifest = parse_manifest(hj.read_text(encoding="utf-8"))

    methods = []
    cross_rows = []
    for key, tail in RE_METHOD_DTS.findall(dtext):
        kind = "stream" if RE_STREAM_MARK.search(tail) else "unary"
        ns, _, name = key.partition("/")
        if key not in manifest:
            raise ValueError("manifest missing method " + key + " in " + str(hj))
        fields, info = cross_check_method(key, dts_params[key], manifest[key])
        if fields.get("stream", False) != (kind == "stream"):
            raise ValueError("kind/manifest mode mismatch for " + key)
        row = {
            "key": key,
            "namespace": ns,
            "name": name,
            "kind": kind,
            "class": "W",
        }
        row.update(fields)
        methods.append(row)
        cross_rows.append(info)

    map_keys = block_keys(dtext, "TypertRemoteMap")
    scope_keys = block_keys(dtext, "TypertRemoteScopeMap")

    jm_start = jtext.find("methods: {")
    js_keys = []
    if jm_start >= 0:
        seg = jtext[jm_start:]
        js_keys = RE_JS_METHOD.findall(seg)

    namespaces = sorted({m["namespace"] for m in methods})

    return {
        "package": pkg,
        "dir": str(js.parent.relative_to(root)),
        "js": str(js.relative_to(root)),
        "dts": str(dts.relative_to(root)),
        "namespaces": namespaces,
        "methods_dts": len(methods),
        "methods_js": len(js_keys),
        "methods_js_match_dts": set(js_keys) == {m["key"] for m in methods},
        "endpoints_map": len(map_keys),
        "scope_variants": scope_keys,
        "methods": methods,
        "_cross_rows": cross_rows,
    }


def render_md(result):
    """v1 兼容：43 工件各自的方法名清单。"""
    t = result["totals"]
    lines = [
        "# 工件-方法清单（CapIR 雏形素材）",
        "",
        "> 由 `scripts/extract_capir_artifacts.py` v2 从宿主 clone 的 `lib/typert.remote-client.{js,d.ts}` + `lib/typert.host.js` 自动生成。",
        "> 只读解析，无 git 动作。W2-0a 干跑产物；本清单不含凭据值。",
        "",
        "## 汇总",
        "",
        f"- 工件数：{t['artifacts']}",
        f"- 方法数（.d.ts = .js）：{t['methods_dts']}",
        f"- 方法分类：unary {t['methods_by_kind']['unary']} / stream {t['methods_by_kind']['stream']}",
        f"- 双源交叉：{t['cross_check']['methods']}/{t['cross_check']['methods']} 全绿（wire 名序 + 可选性 + service）",
        "",
        "## 工件逐项",
        "",
    ]
    for i, a in enumerate(result["artifacts"], 1):
        lines.append(f"### {i}. `{a['package']}`")
        lines.append("")
        lines.append(f"- 目录：`{a['dir']}`")
        lines.append(f"- 方法数：**{a['methods_dts']}**（.js 交叉核对 {a['methods_js']}，键集合一致={a['methods_js_match_dts']}）")
        lines.append("")
        lines.append("| 方法 key | namespace | kind | service | params |")
        lines.append("|---|---|---|---|---|")
        for m in a["methods"]:
            lines.append(f"| `{m['key']}` | `{m['namespace']}` | {m['kind']} | `{m['service']}` | {len(m['params'])} |")
        lines.append("")
    return "\n".join(lines) + "\n"


def render_crosscheck_md(result):
    """逐 service 双源交叉全绿清单：字段名/序/可选性/JSON Schema 一致与否。"""
    cc = result["totals"]["cross_check"]
    lines = [
        "# W2-0a 双源交叉全绿清单",
        "",
        "> `.d.ts` TYPERT_REMOTE（字段名=wire 名、顺序、可选性权威） × `typert.host.js` manifest（service / JSON Schema / typeSymbol）逐方法核对。",
        "> 判据：参数名序列 == manifest wire 名序列（`wire ?? name`）；可选性序列一致；service 非空；kind == manifest mode。",
        "> 凭据纪律：只列键名与计数，不列任何凭据/令牌值；jsonSchema 原文只落 extractor JSON，报告不展开值。",
        "",
        "## 汇总",
        "",
        f"- 工件数：{cc['artifacts']}",
        f"- 方法数：{cc['methods']}",
        f"- 不一致数：{cc['mismatches']}（fail-loud：非零即整脚本退出、无输出）",
        f"- 全绿 service 数：{cc['services_all_green']}/{cc['services_total']}",
        f"- 参数总数：{cc['params_total']}",
        f"- JSON Schema 可用参数：{cc['params_with_schema']}；无/空 schema 走 .d.ts token 兜底：{cc['params_type_fallback']}（{cc['type_fallback_keys']}）",
        f"- lookup 源参数（manifest 逻辑名 != wire 名，由 wire 字段消歧）：{cc['lookup_params']}",
        "",
        "## 逐 service",
        "",
        "| service | 方法数 | 参数数 | 名/序一致 | 可选性一致 | service 非空 | JSON Schema | 结论 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for svc, s in cc["by_service"].items():
        lines.append(
            f"| `{svc}` | {s['methods']} | {s['params']} | {s['names_ok']}/{s['methods']} | "
            f"{s['optional_ok']}/{s['methods']} | {s['service_ok']}/{s['methods']} | "
            f"{s['schema_ok']}/{s['params']} | {'ALL GREEN' if s['all_green'] else 'FAIL'} |"
        )
    lines += ["", "## 类型兜底参数（无/空 jsonSchema）", ""]
    lines.append("| 方法 | 参数名 | .d.ts token | 归一 type |")
    lines.append("|---|---|---|---|")
    for fb in cc["type_fallback_rows"]:
        lines.append(f"| `{fb['method']}` | `{fb['param']}` | `{fb['token']}` | `{fb['type']}` |")
    lines += ["", "## 例外与口径记录", ""]
    lines.append("- 74 条 lookup 参数：manifest 逻辑名（agent/session/workspaceFileScope）与 `.d.ts` wire 名（agentId/sessionId/workspaceFileScopeId）不同，按方案 §0.1 `wire = wire ?? name` 消歧，非不一致。")
    lines.append("- 2 条无/空 jsonSchema 参数走 `.d.ts` token 兜底；`type` 为确定性归一类，不产生值泄露。")
    lines.append("- 报告仅含键名与计数；凭据/令牌值零落盘。")
    return "\n".join(lines) + "\n"


def main():
    argv = sys.argv[1:]
    crosscheck_path = None
    if "--crosscheck" in argv:
        ci = argv.index("--crosscheck")
        if ci + 1 >= len(argv):
            print("usage: --crosscheck <path>", file=sys.stderr)
            return 2
        crosscheck_path = argv[ci + 1]
        argv = argv[:ci] + argv[ci + 2:]
    if len(argv) not in (2, 3):
        print("usage: extract_capir_artifacts.py <clone_root> <out_json> [out_md] [--crosscheck <crosscheck_md>]", file=sys.stderr)
        return 2
    root = Path(argv[0]).resolve()
    out = Path(argv[1]).resolve()
    packages = root / "packages"
    if not packages.is_dir():
        print("ERROR: packages/ not found under " + str(root), file=sys.stderr)
        return 2

    js_files = sorted(packages.rglob("lib/typert.remote-client.js"))
    artifacts = [parse_artifact(j, root) for j in js_files]

    sc = [a for a in artifacts if "session-controller" in a["dir"]]
    sc_endpoints = sc[0]["endpoints_map"] if len(sc) == 1 else None

    sc_remote_src = 0
    sc_remote_by_file = {}
    if sc:
        pkg_dir = Path(sc[0]["dir"]).parent
        src_dir = root / pkg_dir / "src"
        for f in sorted(src_dir.glob("*.ts")):
            n = f.read_text(encoding="utf-8", errors="replace").count("@Remote")
            sc_remote_by_file[f.name] = n
            sc_remote_src += n

    # --- 双源交叉汇总 ---
    by_service = {}
    fallback_rows = []
    params_total = 0
    params_with_schema = 0
    lookup_params = 0
    mismatches = 0
    for a in artifacts:
        svc_rows = {}
        for m, info in zip(a["methods"], a["_cross_rows"]):
            svc = m["service"]
            s = svc_rows.setdefault(svc, {
                "methods": 0, "params": 0, "names_ok": 0, "optional_ok": 0,
                "service_ok": 0, "schema_ok": 0, "all_green": True,
            })
            s["methods"] += 1
            s["params"] += info["param_count"]
            s["names_ok"] += 1 if info["all_match"] else 0
            s["optional_ok"] += 1 if info["all_match"] else 0
            s["service_ok"] += 1 if info["all_match"] else 0
            s["all_green"] = s["all_green"] and info["all_match"]
            params_total += info["param_count"]
            if not info["all_match"]:
                mismatches += 1
            fb_count = 0
            for p in m["params"]:
                if p["jsonSchema"] not in (None, {}):
                    params_with_schema += 1
                else:
                    fb_count += 1
            s["schema_ok"] += info["param_count"] - fb_count
            for fb in info["type_fallback"]:
                fallback_rows.append({"method": m["key"], "param": fb["param"], "token": fb["token"], "type": fb["type"]})
        # lookup 源计数（manifest 逻辑名 != wire 名；从 manifest 原始 source 字段统计）
        hj = root / a["dir"] / "typert.host.js"
        man = parse_manifest(hj.read_text(encoding="utf-8"))
        for key, mo in man.items():
            for p in mo["params"]:
                if p["source"] == "lookup":
                    lookup_params += 1
        for svc, s in svc_rows.items():
            agg = by_service.setdefault(svc, {
                "methods": 0, "params": 0, "names_ok": 0, "optional_ok": 0,
                "service_ok": 0, "schema_ok": 0, "all_green": True,
            })
            for k in ("methods", "params", "names_ok", "optional_ok", "service_ok", "schema_ok"):
                agg[k] += s[k]
            agg["all_green"] = agg["all_green"] and s["all_green"]

    if mismatches:
        print("ERROR: dual-source cross-check FAILED for %d methods; no output written" % mismatches, file=sys.stderr)
        return 1

    totals = {
        "artifacts": len(artifacts),
        "methods_dts": sum(a["methods_dts"] for a in artifacts),
        "methods_js": sum(a["methods_js"] for a in artifacts),
        "methods_all_js_keys_match_dts": all(a["methods_js_match_dts"] for a in artifacts),
        "endpoints_global_map_sum": sum(a["endpoints_map"] for a in artifacts),
        "endpoints_session_controller_map": sc_endpoints,
        "scope_variants_global": sum(len(a["scope_variants"]) for a in artifacts),
        "session_controller_src_remote_count": sc_remote_src,
        "session_controller_src_remote_by_file": sc_remote_by_file,
        "methods_by_kind": {
            "stream": sum(1 for a in artifacts for m in a["methods"] if m["kind"] == "stream"),
            "unary": sum(1 for a in artifacts for m in a["methods"] if m["kind"] == "unary"),
        },
        "methods_by_namespace_top": dict(Counter(m["namespace"] for a in artifacts for m in a["methods"]).most_common()),
        "cross_check": {
            "artifacts": len(artifacts),
            "methods": sum(a["methods_dts"] for a in artifacts),
            "mismatches": mismatches,
            "services_total": len(by_service),
            "services_all_green": sum(1 for s in by_service.values() if s["all_green"]),
            "params_total": params_total,
            "params_with_schema": params_with_schema,
            "params_type_fallback": len(fallback_rows),
            "type_fallback_keys": [fb["method"] + ":" + fb["param"] for fb in fallback_rows],
            "type_fallback_rows": fallback_rows,
            "lookup_params": lookup_params,
            "by_service": by_service,
        },
    }

    result = {
        "source_root": str(root),
        "head_note": "read-only extraction; no git command executed; dual-source cross-check fail-loud",
        "extractor_version": 2,
        "counting_rules": {
            "artifact": "packages/**/lib/typert.remote-client.js 文件数",
            "method": "生成 .d.ts 中 readonly '<ns>/<method>': TypertRemoteMethod<...> 条目；.js methods 键交叉核对",
            "endpoint": "session-controller .d.ts interface TypertRemoteMap 键数（排除 TypertRemoteScopeMap 的 agent-scope 变体）；源码 @Remote 交叉核对",
            "class_W": "./remote client face 全部方法为 CapIR W 类（client 可调用）；I 类为 ctx 直取面，不在生成工件内",
        },
        "totals": totals,
        "artifacts": [{k: v for k, v in a.items() if k != "_cross_rows"} for a in artifacts],
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if len(argv) == 3:
        md = Path(argv[2]).resolve()
        md.parent.mkdir(parents=True, exist_ok=True)
        md.write_text(render_md(result), encoding="utf-8")
        print("Markdown list ->", md)
    if crosscheck_path:
        cp = Path(crosscheck_path).resolve()
        cp.parent.mkdir(parents=True, exist_ok=True)
        cp.write_text(render_crosscheck_md(result), encoding="utf-8")
        print("Cross-check report ->", cp)

    print("extractor v2: artifacts=%d methods=%d params=%d dual_source_mismatches=%d" % (
        totals["artifacts"], totals["methods_dts"], params_total, mismatches))
    print("  fallback-type params=%d lookup params=%d" % (len(fallback_rows), lookup_params))
    print("JSON ->", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
