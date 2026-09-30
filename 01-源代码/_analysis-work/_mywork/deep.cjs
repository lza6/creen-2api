const fs = require('fs');
const path = require('path');
const DIR = "C:\\Users\\Administrator.DESKTOP-EGNE9ND\\Desktop\\creen-2api\\源代码\\_mywork";
const file = process.argv[2];
const arr = JSON.parse(fs.readFileSync(path.join(DIR, `full_${file.replace(/\.js$/,'')}.json`), 'utf8'));

function scan(code, id) {
  const r = {};
  // i18n: (0,X.Y)("ns.key") OR (0,X.Y)({...}) ; capture string literals looking like ns.key
  r.i18n = [...new Set([...code.matchAll(/\(([a-zA-Z0-9_$.]+)\)\(\s*"([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"\s*[,)]/g)].map(m=>({fn:m[1], key:m[2]})))];
  // t( calls with key
  r.tCalls = [...new Set([...code.matchAll(/\b([a-zA-Z_$][\w$]*)\(\s*"((?:[a-z]+\.){1,3}[A-Za-z0-9_]+)"\s*\)/g)].map(m=>m[2]))].filter(k=>/^(error|common|auth|home|generate|account|dashboard|settings|login|signup|pricing|credits|models|pages|nav|footer|header|links|sections|membership|sidebar|notSet|upgrade|freePlan|team|workspace|video|image|audio|music|edit|light|empty)\./.test(k));
  // routes / hrefs
  r.routes = [...new Set([...code.matchAll(/["'`](\/[a-zA-Z][a-zA-Z0-9_\/\-\{\}\[\]\$\.]*)["'`]/g)].map(m=>m[1]))].filter(s=>!s.startsWith('/api') && s.length>1);
  // api
  r.api = [...new Set([...code.matchAll(/["'`](\/api\/[^"'`]+)["'`]/g)].map(m=>m[1]))];
  // jsx component usage: (0,X.jsx)(Comp  or jsx(Comp
  r.jsx = [...new Set([...code.matchAll(/\.jsx[s]?\)\(([A-Z][A-Za-z0-9_$]*)/g)].map(m=>m[1]))];
  // heroui slots
  r.slots = [...new Set([...code.matchAll(/"(HeroUI\.[A-Za-z.]+)"/g)].map(m=>m[1]))];
  return r;
}

for (const m of arr) {
  if (m.code.length < 400) { console.log(`\n### MODULE ${m.id} (tiny, ${m.code.length}b): ${m.code.slice(0,300)}`); continue; }
  const s = scan(m.code, m.id);
  console.log(`\n############ MODULE ${m.id} (bodyLen=${m.code.length}) ############`);
  console.log(`EXPORTS: ${JSON.stringify(m.exports)}`);
  console.log(`IMPORTS: ${JSON.stringify(m.imports.slice(0,40))}`);
  if (m.hooks.length) console.log(`HOOKS: ${JSON.stringify(m.hooks)}`);
  if (m.funcs.length) console.log(`FUNCS: ${JSON.stringify(m.funcs)}`);
  if (s.api.length) console.log(`API: ${JSON.stringify(s.api)}`);
  if (s.routes.length) console.log(`ROUTES: ${JSON.stringify(s.routes.slice(0,60))}`);
  if (s.i18n.length) console.log(`I18N: ${JSON.stringify(s.i18n.slice(0,80))}`);
  else if (s.tCalls.length) console.log(`I18N_KEYS: ${JSON.stringify(s.tCalls.slice(0,80))}`);
  if (s.jsx.length) console.log(`JSX_COMPONENTS: ${JSON.stringify(s.jsx.slice(0,60))}`);
}
