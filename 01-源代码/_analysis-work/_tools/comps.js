const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const INDEX = require(path.join(DIR, '_index.json'));
const ORDER = ['4703-e0bc1e848e11cfd1.js','1684-d2140a08e94eddcf.js','8998-2ba350a81170d9d3.js','4bd1b696-ab5084ee51b12804.js','8038-9e3022796da2ef05.js','3364-89bd5f98193af6c5.js','7261-fec5a8b366a0fc5a.js','683-a3fbc998c87d8cba.js'];

for (const file of ORDER) {
  const comps = new Map();
  for (const mod of INDEX[file].modules) {
    const body = fs.readFileSync(path.join(DIR,'_mod',file.replace('.js',''),mod.id+'.js'),'utf8');
    let m;
    // displayName assignments: X.displayName="Y" or displayName:"Y"
    let re = /\.displayName\s*=\s*["']([^"']+)["']/g;
    while ((m = re.exec(body)) !== null) if (m[1].length>1&&m[1].length<40) comps.set(m[1], mod.id);
    re = /displayName\s*:\s*["']([^"']+)["']/g;
    while ((m = re.exec(body)) !== null) if (m[1].length>1&&m[1].length<40) comps.set(m[1], mod.id);
    // function declarations PascalCase
    re = /function\s+([A-Z][A-Za-z0-9_$]{2,35})\s*\(/g;
    while ((m = re.exec(body)) !== null) comps.set(m[1], mod.id);
  }
  console.log(`\n### ${file} component-like names (${comps.size}):`);
  console.log([...comps.keys()].sort().join(', '));
}
