const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const INDEX = require(path.join(DIR, '_index.json'));

const FILE_ORDER = ['4703-e0bc1e848e11cfd1.js','1684-d2140a08e94eddcf.js','8998-2ba350a81170d9d3.js','4bd1b696-ab5084ee51b12804.js','8038-9e3022796da2ef05.js','3364-89bd5f98193af6c5.js','7261-fec5a8b366a0fc5a.js','683-a3fbc998c87d8cba.js'];

// strings that strongly indicate a library identity
function sigStrings(body) {
  const out = [];
  let m;
  const re = /["'`]([^"'`\n]{3,90})["'`]/g;
  while ((m = re.exec(body)) !== null) {
    const s = m[1];
    if (/^https?:\/\//.test(s)) { out.push('URL:'+s); continue; }
    if (/^[a-z]$/.test(s) || /^[A-Z]$/.test(s)) continue;
    // keep if looks like identifier/package/message/className
    if (/[A-Z]/.test(s) && /[a-z]/.test(s)) out.push(s);
    else if (/@[a-z-]+\/[a-z-]+/.test(s)) out.push(s);
    else if (/[.-]/.test(s) && s.length > 5 && /[a-z]/.test(s)) out.push(s);
    else if (/[:?].*error|Error|invariant|must be|invalid/i.test(s)) out.push(s);
  }
  // uniqueness + prefer package/provider/aria/HeroUI markers
  const uniq = [...new Set(out)];
  const pri = (s) => {
    let sc = 0;
    if (/@react-aria|@react-stately|@heroui|@iconify|framer-motion|@floating-ui|@tanstack|react-query|react-hook-form|zustand|axios|zod|clsx|tailwind|nextui|heroui|@radix|swiper|lottie|emoji|tiptap|monaco|hls|player|dayjs|lodash|stripe|supabase|firebase|posthog|sentry|qrcode|google|apple|turnstile|cloudflare/i.test(s)) sc += 5;
    if (/HeroUI\.|Provider$|Context$|Boundary$|Icon$|Error|invariant|must be|cannot|failed|invalid/i.test(s)) sc += 3;
    if (/^[A-Z]/.test(s) && s.split(/\s/).length > 1) sc += 1;
    sc -= Math.min(s.length/40, 2);
    return sc;
  };
  return uniq.sort((a,b)=>pri(b)-pri(a)).slice(0, 14);
}

let txt = '';
for (const file of FILE_ORDER) {
  txt += `\n\n########## ${file}  (modules=${INDEX[file].count}, chunk=${INDEX[file].chunkId})\n`;
  const mods = INDEX[file].modules.slice().sort((a,b)=>b.bytes-a.bytes);
  for (const mod of mods) {
    const body = fs.readFileSync(path.join(DIR,'_mod',file.replace('.js',''),mod.id+'.js'),'utf8');
    const sig = sigStrings(body);
    const exp = mod.exports.map(e=>e.name + (e.local?'='+e.local:'')).join(',');
    txt += `[${mod.id}] ${mod.bytes}B exp{${exp}} :: ${sig.join(' ~ ')}\n`;
  }
}
fs.writeFileSync(path.join(DIR,'_module_sig.txt'), txt);
console.log('bytes', txt.length);
