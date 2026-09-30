const fs = require('fs');
const path = require('path');
const DIR = "C:\\Users\\Administrator.DESKTOP-EGNE9ND\\Desktop\\creen-2api\\源代码\\_mywork";
const file = process.argv[2];
const arr = JSON.parse(fs.readFileSync(path.join(DIR, `full_${file.replace(/\.js$/, '')}.json`), 'utf8'));
// find namespace declarations: useTranslation("ns")  -> in this codebase (0,X.c3)("ns")
for (const m of arr) {
  const c = m.code;
  const ns = [...new Set([...c.matchAll(/\.c3\)\("([a-zA-Z][a-zA-Z0-9_]*)"\)|\.c3\)\(\)|useTranslation\("([a-zA-Z][a-zA-Z0-9_]*)"\)/g)].map(x => x[1]||x[2]||'(default)'))];
  // t("key") where receiver likely a t-fn var; only keep keys with a dot or camelCase label
  const keys = [...new Set([...c.matchAll(/\b([a-zA-Z_$][\w$]*)\(\s*"([a-zA-Z][a-zA-Z0-9_]{2,40})"\s*\)/g)].map(x => x[1] + '::' + x[2]))];
  const dotted = [...new Set([...c.matchAll(/"([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]{2,40})"/g)].map(x => x[1]))];
  const rich = [...new Set([...c.matchAll(/\.rich\(\s*"([a-zA-Z][a-zA-Z0-9_.]*)"\s*,\s*\{([^}]*)\}/g)].map(x => x[1] + ' vars[' + x[2].replace(/\s+/g,' ').slice(0,80) + ']'))];
  const hasI18n = ns.length || keys.length || dotted.length;
  if (!hasI18n) continue;
  console.log(`\n===== MODULE ${m.id} =====`);
  if (ns.length) console.log('NS(c3):', JSON.stringify(ns));
  if (dotted.length) console.log('DOTTED_KEYS:', JSON.stringify(dotted));
  if (rich.length) console.log('RICH_KEYS:', JSON.stringify(rich));
  if (keys.length) console.log('KEYS(fn::key):', JSON.stringify(keys));
}
