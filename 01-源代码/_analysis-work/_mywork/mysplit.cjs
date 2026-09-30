const fs = require('fs');
const path = require('path');
const DIR = "C:\\Users\\Administrator.DESKTOP-EGNE9ND\\Desktop\\creen-2api\\源代码";
const OUT = path.join(DIR, "_mywork");

const files = process.argv.slice(2);
if (!files.length) { console.error("usage: node mysplit.cjs <file...>"); process.exit(1); }

// Split modules within push([[chunk],{ ... }])
function splitModules(src) {
  const m = /push\(\[\[[^\]]*\]\s*,\s*\{/.exec(src);
  if (!m) return { modules: [], chunkId: null };
  const chunkId = (src.slice(0, 200).match(/\[\[(\d+)/) || [])[1];
  const start = m.index + m[0].length - 1;
  let depth = 0, end = -1, inStr = null, esc = false, tpl = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') esc = true; else if (c === inStr) inStr = null; continue; }
    if (tpl) { if (c === '\\') esc = true; else if (c === '`') tpl = false; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '`') { tpl = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(start + 1, end);
  const modules = [];
  let d = 0, arrD = 0, parD = 0, keyStart = 0, str = null, esc2 = false, tpl2 = false;
  const flush = (chunk) => {
    const mm = /^\s*("?[\w$]+"?)\s*:\s*/.exec(chunk);
    if (!mm) return;
    const id = mm[1].replace(/"/g, '');
    modules.push({ id, code: chunk.slice(mm[0].length).trim() });
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (esc2) { esc2 = false; continue; }
    if (str) { if (c === '\\') esc2 = true; else if (c === str) str = null; continue; }
    if (tpl2) { if (c === '\\') esc2 = true; else if (c === '`') tpl2 = false; continue; }
    if (c === '"' || c === "'") { str = c; continue; }
    if (c === '`') { tpl2 = true; continue; }
    if (c === '{') d++; else if (c === '}') d--;
    else if (c === '[') arrD++; else if (c === ']') arrD--;
    else if (c === '(') parD++; else if (c === ')') parD--;
    else if (c === ',' && d === 0 && arrD === 0 && parD === 0) {
      flush(body.slice(keyStart, i)); keyStart = i + 1;
    }
  }
  flush(body.slice(keyStart));
  return { modules, chunkId };
}

// Extract various signals from a module body
function analyze(code) {
  const res = {};
  const argm = /^\(([^)=]*)\)\s*=>\s*/.exec(code) || /^function\s*\(([^)]*)\)/.exec(code);
  res.args = argm ? argm[1] : '';
  // imports: var x=r(12345)  /  r.e(123)  dynamic
  const imports = [...code.matchAll(/[a-zA-Z_$][\w$]*\s*=\s*[a-zA-Z_$][\w$]*\((\d{3,6})\)/g)].map(x => x[1]);
  res.imports = [...new Set(imports)];
  // exports: <arg>.d(<exp>,{ name:()=>local, ... })
  const exp = [];
  const dm = /[a-zA-Z_$][\w$]*\.d\([a-zA-Z_$][\w$]*,\s*\{([^}]*)\}/g;
  let mm;
  while ((mm = dm.exec(code))) {
    for (const kv of mm[1].split(',')) {
      const km = /([\w$"]+)\s*:\s*\(?\)?\s*=>\s*([\w$]+)/.exec(kv.trim());
      if (km) exp.push({ exported: km[1].replace(/"/g,''), local: km[2] });
    }
  }
  res.exports = exp;
  // dynamic import chunk ids: r.e(NNN)
  res.dynChunks = [...new Set([...code.matchAll(/[a-zA-Z_$][\w$]*\.e\((\d{2,5})\)/g)].map(x => x[1]))];
  // i18n namespaces: useTranslation("ns") patterns; t("ns.key")
  res.i18nT = [...new Set([...code.matchAll(/[a-zA-Z_$][\w$]*\(\s*"([a-zA-Z0-9_]+)\.[a-zA-Z0-9_.]+"\s*\)/g)].map(x=>x[1]))];
  res.i18nKeys = [...new Set([...code.matchAll(/"((?:[a-zA-Z0-9_]+\.){1,4}[a-zA-Z0-9_]+)"/g)].map(x=>x[1]))].filter(k=>
     /^(error|common|auth|home|generate|account|dashboard|settings|login|signup|pricing|credits|models|pages|nav|footer|header)\./.test(k));
  // api paths
  res.api = [...new Set([...code.matchAll(/["'`](\/api\/[a-zA-Z0-9_\/\-\{\}\$\.]+)["'`]/g)].map(x=>x[1]))];
  // react component names: function Name / const Name=... with uppercase
  res.funcs = [...new Set([...code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(x=>x[1]))];
  // hooks used: [a-zA-Z].useXxx(  on React namespace or named
  res.hooks = [...new Set([...code.matchAll(/\b(use[A-Z][A-Za-z0-9_$]*)\s*\(/g)].map(x=>x[1]))];
  // string literals of interest (routes, enums) - quoted strings length 3..80 not pure symbols
  res.strings = [...new Set([...code.matchAll(/"([A-Za-z][A-Za-z0-9 _\/\-\.:]{2,60})"/g)].map(x=>x[1]))];
  // numeric arrays (enums) - basic
  return res;
}

for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  const { modules, chunkId } = splitModules(src);
  let rep = `### FILE ${f}  chunk=${chunkId}  modules=${modules.length}  totalBytes=${src.length}\n`;
  const json = [];
  for (const mo of modules) {
    const a = analyze(mo.code);
    json.push({ id: mo.id, ...a, code: mo.code });
    rep += `\n========== MODULE ${mo.id} (args=[${a.args}] bodyLen=${mo.code.length}) ==========\n`;
    rep += `EXPORTS: ${JSON.stringify(a.exports)}\n`;
    rep += `IMPORTS: ${JSON.stringify(a.imports)}\n`;
    rep += `DYN_CHUNKS: ${JSON.stringify(a.dynChunks)}\n`;
    if (a.api.length) rep += `API: ${JSON.stringify(a.api)}\n`;
    if (a.hooks.length) rep += `HOOKS: ${JSON.stringify(a.hooks)}\n`;
    if (a.funcs.length) rep += `FUNCS: ${JSON.stringify(a.funcs)}\n`;
    if (a.i18nKeys.length) rep += `I18N_KEYS: ${JSON.stringify(a.i18nKeys)}\n`;
    rep += `STRINGS: ${JSON.stringify(a.strings.slice(0,120))}\n`;
  }
  const base = f.replace(/\.js$/, '');
  fs.writeFileSync(path.join(OUT, `summary_${base}.txt`), rep, 'utf8');
  fs.writeFileSync(path.join(OUT, `full_${base}.json`), JSON.stringify(json, null, 1), 'utf8');
  console.log(`${f}: chunk=${chunkId} modules=${modules.length}`);
}
console.log("DONE");
