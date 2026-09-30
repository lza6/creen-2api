// Dump distinctive strings + require deps + export names per module
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const INDEX = require(path.join(DIR, '_index.json'));

function reqs(body) {
  const s = new Set();
  let m, re = /\b([a-zA-Z_$][\w$]*)\((\d{3,7})\)/g;
  while ((m = re.exec(body)) !== null) s.add(m[2]);
  return [...s];
}
// distinctive strings: contain hyphen+digits, camelCase multiword, error-like, version-like
function strings(body) {
  const out = [];
  let m, re = /["'`]([A-Za-z@][\w@\/\.\-: ]{3,80})["'`]/g;
  while ((m = re.exec(body)) !== null) {
    const s = m[1];
    if (/^https?:/.test(s)) continue;
    out.push(s);
  }
  return out;
}

const out = {};
for (const file in INDEX) {
  out[file] = [];
  for (const mod of INDEX[file].modules) {
    const body = fs.readFileSync(path.join(DIR, '_mod', file.replace('.js',''), mod.id + '.js'), 'utf8');
    const strs = strings(body);
    // pick distinctive: has uppercase+lowercase mix and length>6, or contains known tokens
    const distinct = [...new Set(strs)].filter(s =>
      /react|aria|motion|heroui|nextui|iconify|framer|radix|remix|floating|swiper|virtuoso|zustand|tanstack|query|axios|zod|clsx|tailwind|hook-form|dayjs|lodash|emoji|tiptap|lottie|stripe|supabase|firebase|hls|player|dropzone|toast|sonner|locale|i18n|intl|svg|Icon|Provider|Provider|Boundary|render|hydrat|Suspense|Context|Dispatch|Element|transition|animate|Variants|drag|Gesture|Press|Focus|Overlay|Modal|Dialog/i.test(s)
    ).slice(0, 25);
    out[file].push({ id: mod.id, bytes: mod.bytes, reqs: reqs(body), exports: mod.exports.map(e=>e.name), distinct });
  }
}
fs.writeFileSync(path.join(DIR, '_strings.json'), JSON.stringify(out, null, 2));
console.log('done');
