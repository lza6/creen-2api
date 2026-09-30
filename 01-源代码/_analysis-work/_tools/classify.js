// Classify modules business vs third-party and emit per-file readable report
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const F = require(path.join(DIR, '_features.json'));

const BIZ_FIELDS = ['integral','credits','credit','coin','points','balance','wallet','prompt','project','comic','audio','video','image','model','models','task','job','aspectRatio','resolution','character','scene','manga','anime','upload','generate','creation','subscription','subscribe','plan','vip','order','payment','invite','referral','profile','avatar','nickname','history','favorite','collect','publish','draft','explore','inspiration','community','user','login','register','sign'];
const BIZ_I18N = /^(aiGenerator|dailyPointsModal|inspirationWall|explore|links|sections|nav|studio|profile|pricing|header|footer|login|register|common|model|comic|video|audio|home|index|auth|account|settings|create|works|notifications|share|download|upload)/i;

function classify(mod) {
  const f = mod.feat;
  let biz = 0, tp = 0;
  const reasons = [];

  const bizApiPaths = f.paths.filter(p => /^\/(api|v1|v2)\//.test(p));
  biz += bizApiPaths.length * 3;
  if (bizApiPaths.length) reasons.push('api:' + bizApiPaths.length);

  const bizKeys = f.i18nKeys.filter(k => BIZ_I18N.test(k));
  biz += bizKeys.length * 2;
  if (bizKeys.length) reasons.push('i18n:' + bizKeys.length);

  const bf = f.fields.filter(x => BIZ_FIELDS.includes(x));
  biz += bf.length;
  if (bf.length) reasons.push('fields:' + bf.length);

  if (f.chinese.length) { biz += 3; reasons.push('zh:' + f.chinese.length); }

  const coreLibs = ['React core','react-dom'];
  if (f.libs.some(l => coreLibs.includes(l))) { tp += 8; reasons.push('react-core'); }
  // heavy third-party libs
  const tpLibs = f.libs.filter(l => !coreLibs.includes(l));
  tp += tpLibs.length * 2;
  if (tpLibs.length) reasons.push('libs:' + tpLibs.join('|'));

  // Next.js internals are third-party
  if (f.libs.includes('Next.js') && !biz) tp += 3;

  return { biz, tp, isBusiness: biz > tp && biz >= 2, reasons };
}

const summaryRows = [];
const perFile = {};
for (const file in F) {
  const rows = [];
  for (const mod of F[file].modules) {
    const { biz, tp, isBusiness, reasons } = classify(mod);
    const r = { id: mod.id, bytes: mod.bytes, isBusiness, biz, tp, reasons, exports: mod.exports, feat: mod.feat };
    rows.push(r);
    summaryRows.push({ file, id: mod.id, bytes: mod.bytes, isBusiness, biz, tp });
  }
  perFile[file] = rows;
}
fs.writeFileSync(path.join(DIR, '_classified.json'), JSON.stringify(perFile, null, 2));

// Print distribution
console.log('=== DISTRIBUTION ===');
for (const file in perFile) {
  const rows = perFile[file];
  const biz = rows.filter(r => r.isBusiness).length;
  console.log(`${file}\tmodules=${rows.length}\tbusiness=${biz}\tthirdparty=${rows.length - biz}`);
}
console.log('TOTAL business modules:', summaryRows.filter(r => r.isBusiness).length);
