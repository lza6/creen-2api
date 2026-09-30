const fs = require('fs');
const path = require('path');
const DIR = "C:\\Users\\Administrator.DESKTOP-EGNE9ND\\Desktop\\creen-2api\\源代码\\_mywork";
const file = process.argv[2];
const modId = process.argv[3];
const arr = JSON.parse(fs.readFileSync(path.join(DIR, `full_${file.replace(/\.js$/, '')}.json`), 'utf8'));
const m = arr.find(x => x.id === String(modId));
if (!m) { console.log('module not found; ids=', arr.map(x=>x.id).join(',')); process.exit(0); }
const code = m.code;
const out = {};
out.jsxTargets = [...new Set([...code.matchAll(/\.jsxs?\)\(([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)].map(x => x[1] + (x[2] ? '.' + x[2] : '')))];
// i18n: (0,X.Y)("a.b")  -> capture
out.i18nCalls = [...new Set([...code.matchAll(/\)\s*\(\s*"([a-zA-Z][a-zA-Z0-9_.]+)"/g)].map(x => x[1]))];
// namespace detection: X("ns") inside useTranslation-ish
out.nsGuess = [...new Set([...code.matchAll(/([\w$]+)\(\s*"([a-z][a-zA-Z0-9_]*)"\s*\)/g)].map(x => x[1] + ' > ' + x[2]))];
// object keys with i18n-like dotted values
out.dotted = [...new Set([...code.matchAll(/"((?:[a-z]+\.){1,3}[A-Za-z0-9_]+)"/g)].map(x => x[1]))];
// string constants that look like labels/enums
out.upperEnums = [...new Set([...code.matchAll(/"([A-Z][A-Z0-9_]{2,20})"/g)].map(x => x[1]))];
// API
out.api = [...new Set([...code.matchAll(/["'`](\/api\/[^"'`]+)["'`]/g)].map(x => x[1]))];
// hooks
out.hooks = [...new Set([...code.matchAll(/\b(use[A-Z][A-Za-z0-9_$]*)\s*\(/g)].map(x => x[1]))];
console.log(JSON.stringify(out, null, 1));
