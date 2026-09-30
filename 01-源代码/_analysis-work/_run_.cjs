// Robust webpack module splitter + analyzer for creeen.ai Next.js chunks
// Run: node _run.cjs
const fs = require('fs');
const path = require('path');
const DIR = __dirname;

const FILES = [
  '4703-e0bc1e848e11cfd1.js',
  '1684-d2140a08e94eddcf.js',
  '8998-2ba350a81170d9d3.js',
  '4bd1b696-ab5084ee51b12804.js',
  '8038-9e3022796da2ef05.js',
  '3364-89bd5f98193af6c5.js',
  '7261-fec5a8b366a0fc5a.js',
  '683-a3fbc998c87d8cba.js',
];

// --- brace matching that skips strings/templates/comments ---
function matchBrace(src, start) {
  let depth = 0, i = start, inStr = null, inTpl = false, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (inTpl) { if (c === '\\') { i++; continue; } if (c === '`') inTpl = false; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '`') { inTpl = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function findModuleMapStart(src) {
  const p = src.indexOf('push([');
  if (p < 0) return -1;
  const bracket = src.indexOf('],', p);
  return src.indexOf('{', bracket);
}

// Walk top-level of module map and split each entry at its own brace depth
function splitModules(src) {
  const mapStart = findModuleMapStart(src);
  if (mapStart < 0) return [];
  const mapEnd = matchBrace(src, mapStart);
  const modules = [];
  // Scan top-level tokens between mapStart+1 and mapEnd.
  // Module entry form: NUMBER:(a,b,c)=>{  ...  }
  let i = mapStart + 1;
  const entryRe = /(\d{1,8}):\(([\w$]+)(?:,([\w$]+))?(?:,([\w$]+))?\)=>/y;
  while (i < mapEnd) {
    const c = src[i];
    if (c === ',' || c === ' ' || c === '\n' || c === '\r' || c === '\t') { i++; continue; }
    entryRe.lastIndex = i;
    const m = entryRe.exec(src);
    if (!m) { break; }
    const after = i + m[0].length;
    // Skip whitespace, then expect '{'
    let j = after;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] !== '{') { break; }
    const bodyEnd = matchBrace(src, j);
    modules.push({
      id: m[1],
      args: [m[2], m[3], m[4]].filter(Boolean),
      body: src.slice(j + 1, bodyEnd),
      raw: src.slice(i, bodyEnd + 1),
    });
    i = bodyEnd + 1;
  }
  return modules;
}

// --- export extraction: n.d(t,{a:()=>x, b:()=>y}) ---
function getExports(body) {
  const out = [];
  const reD = /\.d\([\w$]+,(\{)/g;
  let m;
  while ((m = reD.exec(body)) !== null) {
    const open = reD.lastIndex - 1;
    const close = matchBrace(body, open);
    const inner = body.slice(open + 1, close);
    let depth = 0, cur = '', parts = [];
    for (const ch of inner) {
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      if (ch === '}' || ch === ']' || ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    for (const p of parts) {
      const mm = p.trim().match(/^([\w$]+):\(\)=>([\w$\.\$]+)$/);
      if (mm) out.push({ name: mm[1], local: mm[2] });
      else if (p.trim()) out.push({ name: p.trim().split(':')[0], local: null });
    }
  }
  return out;
}

// --- feature detection ---
const API_RE = /["'`](\/(?:api|v1|openai)\/[A-Za-z0-9_\-{}\/\.\$\:]*)/g;
const C3_RE = /\bc3\(/g;
const URL_RE = /["'`](https?:\/\/[^"'`\s]{4,120})["'`]/g;
const PATH_RE = /["'`](\/[A-Za-z0-9_\-\.\[\]]{2,80})["'`]/g;

function detectFeatures(body) {
  const feat = {};
  const apis = new Set();
  let m;
  const apiRe = /["'`](https?:\/\/[^"'`]*|\/[A-Za-z0-9_\-\.\/{}\$:]{2,120})["'`]/g;
  while ((m = apiRe.exec(body)) !== null) {
    const s = m[1];
    if (/^\/(api|v1)\//.test(s) || /^https?:\/\//.test(s)) apis.add(s);
  }
  feat.paths = [...apis];
  feat.c3Calls = (body.match(C3_RE) || []).length;
  // i18n key style: t("a.b.c")
  const keys = new Set();
  const kRe = /\b(?:c3|t)\(\s*["'`]([a-zA-Z][\w]*(?:\.[\w]+){1,5})["'`]/g;
  while ((m = kRe.exec(body)) !== null) keys.add(m[1]);
  feat.i18nKeys = [...keys];
  // business field names
  const FIELDS = ['integral', 'model', 'prompt', 'project', 'comic', 'audio', 'video', 'credits',
    'coin', 'token', 'user', 'login', 'register', 'subscription', 'plan', 'vip', 'order',
    'payment', 'invite', 'referral', 'task', 'job', 'aspectRatio', 'resolution', 'style',
    'character', 'scene', 'manga', 'anime', 'image', 'upload', 'generate', 'creation'];
  feat.fields = FIELDS.filter(f => new RegExp('\\b' + f + '\\b', 'i').test(body));
  // library signature detection
  feat.libraries = [];
  const LIB_SIGS = [
    [/\$\$typeof|\bREACT_ELEMENT_TYPE\b|react\.element/, 'react-internals'],
    [/useInsertionEffect|useSyncExternalStore|\.__SECRET_INTERNALS/, 'react-internals'],
    [/\bcreateMotionComponent\b|\bframer-|motionValue|VisualElement|useDomEvent/, 'framer-motion'],
    [/react-aria|useFocusRing|useHover|usePress|PressResponder/, 'react-aria'],
    [/@react-aria|useSelectableCollection|selectionManager/, 'react-aria'],
    [/hero-?ui|heroui|HEROUI/, 'heroui'],
    [/iconify|@iconify|iconData/, 'iconify'],
    [/dayjs|moment\(|\.format\(["']YYYY/, 'dayjs/moment'],
    [/lottie|bodymovin/, 'lottie'],
    [/react-query|QueryClient|useQuery|useMutation/, 'react-query'],
    [/zustand|createStore|useStore/, 'zustand'],
    [/axios\.|AxiosError|\baxios\b/, 'axios'],
    [/next\/dist|__NEXT_DATA__|NextRouter/, 'next.js'],
    [/luxon|DateTime\.fromISO/, 'luxon'],
    [/zod|ZodError|z\.object/, 'zod'],
    [/nanoid|uuid|uuidv4/, 'nanoid/uuid'],
    [/clsx|classnames|classNames/, 'clsx'],
    [/tailwind-merge|twMerge/, 'tailwind-merge'],
    [/react-hook-form|useForm|Controller/, 'react-hook-form'],
    [/radix|@radix-ui/, 'radix-ui'],
    [/swiper/, 'swiper'],
    [/emoji-mart|emojiMart/, 'emoji-mart'],
    [/i18next|i18nextOptions|changeLanguage/, 'i18next'],
    [/react-markdown|remark|rehype/, 'react-markdown'],
    [/lucide|LucideIcon/, 'lucide-icons'],
    [/react-fast-marquee|marquee/i, 'react-fast-marquee'],
    [/react-virtuoso|Virtuoso|virtuoso/, 'react-virtuoso'],
    [/@floating-ui|floating-ui/, 'floating-ui'],
    [/useGesture|@use-gesture/, 'use-gesture'],
    [/react-use-measure/, 'react-use-measure'],
    [/sonner|Toaster|toast\(/, 'sonner'],
    [/@headlessui|headlessui/, 'headlessui'],
    [/recharts|ResponsiveContainer/, 'recharts'],
    [/pg-core|drizzle/, 'drizzle'],
    [/stripe/i, 'stripe'],
  ];
  for (const [re, name] of LIB_SIGS) {
    if (re.test(body)) feat.libraries.push(name);
  }
  // component names: className-less; detect function comps returning jsx
  const comps = new Set();
  const compRe = /(?:function\s+([A-Z][\w$]{2,40})|([A-Z][\w$]{2,40})\s*=\s*(?:\([^)]*\)|[\w$]+)\s*=>)/g;
  while ((m = compRe.exec(body)) !== null) {
    comps.add(m[1] || m[2]);
  }
  feat.components = [...comps].slice(0, 60);
  // all string literals that look like UI text (chinese or long english sentence)
  const texts = new Set();
  const tRe = /["'`]([^"'`\n]{4,80})["'`]/g;
  while ((m = tRe.exec(body)) !== null) {
    const s = m[1];
    if (/[一-鿿]/.test(s) || (/^[A-Z]/.test(s) && /\s/.test(s) && /[a-z]/.test(s) && !/[{}()<>;=]/.test(s))) texts.add(s);
  }
  feat.texts = [...texts].slice(0, 80);
  return feat;
}

function classify(feat, body) {
  const score = { business: 0, thirdparty: 0 };
  if (feat.c3Calls > 0) score.business += 5;
  if (feat.i18nKeys.some(k => /^(aiGenerator|dailyPointsModal|explore|inspirationWall|links|sections|nav|studio|profile|pricing)/.test(k))) score.business += 4;
  score.business += feat.paths.filter(p => /^\/(api|v1)\//.test(p)).length * 2;
  score.business += feat.fields.length;
  const bizFields = ['integral', 'credits', 'prompt', 'video', 'audio', 'comic', 'project', 'subscription'];
  score.business += feat.fields.filter(f => bizFields.includes(f)).length;
  if (feat.libraries.includes('react-internals')) score.thirdparty += 3;
  if (feat.libraries.length > 0) score.thirdparty += 2;
  if (feat.texts.some(t => /[一-鿿]/.test(t))) score.business += 2;
  // heuristics: react internals dominate
  const isReactCore = /\$\$typeof|ReactCurrentOwner|ReactCurrentDispatcher|ReactNoopUpdateQueue/.test(body);
  if (isReactCore) score.thirdparty += 6;
  return score;
}

const report = {};
const allModules = [];
for (const file of FILES) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  const mods = splitModules(src);
  const rows = [];
  for (const mod of mods) {
    const feat = detectFeatures(mod.body);
    const score = classify(feat, mod.body);
    const isBusiness = score.business > score.thirdparty && score.business >= 2;
    rows.push({
      id: mod.id,
      bytes: mod.body.length,
      exports: getExports(mod.body),
      feat,
      score,
      isBusiness,
    });
    allModules.push({ file, ...mod, feat, score, isBusiness });
  }
  report[file] = rows;
  console.log(`${file}: ${mods.length} modules`);
}

fs.writeFileSync(path.join(DIR, '_report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(DIR, '_allmodules.json'), JSON.stringify(allModules.map(m => ({
  file: m.file, id: m.id, bytes: m.body.length, isBusiness: m.isBusiness, score: m.score, feat: m.feat,
})), null, 2));
console.log('DONE');
