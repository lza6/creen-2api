// 用 vm 直接执行 JSON.parse 表达式提取语言包（对齐浏览器语义）
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const DIR = path.join(__dirname, "chunks");

const LANG_FILES = { "zh-Hans": "4568.5718ba6eed7b1992.js", "zh-Hant": "6329.7765d894ce4a6f42.js" };
const CHUNK_LOCALE = {
  6370: "ar", 233: "ca", 8459: "cs", 9758: "da", 9690: "de", 6508: "el",
  4050: "en", 1902: "es-419", 7371: "es-MX", 4525: "es", 2708: "fi",
  9441: "fr", 7150: "he", 7202: "hi", 379: "hr", 6990: "hu", 9496: "id",
  5080: "it", 7144: "ja", 8847: "ko", 5221: "ms", 9625: "nb", 4039: "nl",
  1117: "pl", 8562: "pt-BR", 8997: "pt", 7978: "ro", 3564: "ru",
  6931: "sk", 2888: "sv", 3269: "th", 3359: "tr", 3669: "uk", 8292: "vi",
};

const outDir = path.join(__dirname, "locales");
fs.mkdirSync(outDir, { recursive: true });

function extractJSON(file) {
  const s = fs.readFileSync(path.join(DIR, file), "utf8");
  const i = s.indexOf("JSON.parse(");
  if (i < 0) return null;
  // 找到 JSON.parse( 对应的右括号
  let depth = 0, j = i + "JSON.parse".length, end = -1;
  for (; j < s.length; j++) {
    if (s[j] === "(") depth++;
    else if (s[j] === ")") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) return null;
  const expr = s.slice(i, end + 1);   // "JSON.parse('...')"
  try {
    const ctx = { JSON };
    return vm.runInNewContext(expr, ctx);
  } catch (e) {
    return { _err: e.message };
  }
}

let ok = 0;
const report = [];
for (const [locale, f] of Object.entries(LANG_FILES)) {
  const obj = extractJSON(f);
  if (obj && !obj._err) { fs.writeFileSync(path.join(outDir, locale + ".json"), JSON.stringify(obj, null, 2)); ok++; report.push(locale); }
  else report.push(locale + ":" + (obj?._err || "fail"));
}
for (const [chunkId, locale] of Object.entries(CHUNK_LOCALE)) {
  const file = fs.readdirSync(DIR).filter(x => x.startsWith(chunkId + "."))[0];
  if (!file) continue;
  const obj = extractJSON(file);
  if (obj && !obj._err) { fs.writeFileSync(path.join(outDir, locale + ".json"), JSON.stringify(obj, null, 2)); ok++; }
}
console.log("提取语言包:", ok, "个");
console.log(report.join(", "));

const zh = extractJSON("4568.5718ba6eed7b1992.js");
if (zh && !zh._err) {
  console.log("\nzh-Hans 命名空间:", Object.keys(zh).join(", "));
  console.log("字符数:", JSON.stringify(zh).length);
}
