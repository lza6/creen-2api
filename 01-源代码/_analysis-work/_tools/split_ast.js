// AST-based webpack module splitter using acorn (robust, exact boundaries)
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, 'node_modules', 'acorn'));
const DIR = path.join(__dirname, '..');

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

function parseModuleMap(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
  // find ExpressionStatement -> CallExpression -> callee MemberExpression .push
  let mapNode = null, chunkId = null;
  function walk(node, cb) {
    if (!node || typeof node.type !== 'string') return;
    cb(node);
    for (const k in node) {
      if (k === 'start' || k === 'end' || k === 'type') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(x => walk(x, cb));
      else if (v && typeof v.type === 'string') walk(v, cb);
    }
  }
  walk(ast, (node) => {
    if (mapNode) return;
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'MemberExpression' &&
        node.callee.property && node.callee.property.name === 'push' &&
        node.arguments.length >= 1 && node.arguments[0].type === 'ArrayExpression') {
      const arr = node.arguments[0];
      // push([[chunkId], { moduleMap }])
      const inner = arr.elements[0];
      if (inner && inner.type === 'ArrayExpression' && inner.elements[0]) chunkId = inner.elements[0].value;
      else if (inner) chunkId = inner.value;
      const mapEl = arr.elements.find(e => e && e.type === 'ObjectExpression');
      if (mapEl) mapNode = mapEl;
    }
  });
  return { mapNode, chunkId };
}

function getExportsFromAst(fnNode, src) {
  // Look for <param>.d(<param>,{...}) calls in body
  const out = [];
  const body = fnNode.body;
  if (!body || body.type !== 'BlockStatement') return out;
  function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'MemberExpression' &&
        node.callee.property && node.callee.property.name === 'd' &&
        node.arguments.length === 2 && node.arguments[1].type === 'ObjectExpression') {
      for (const prop of node.arguments[1].properties) {
        if (prop.type !== 'Property') continue;
        const key = prop.key.type === 'Identifier' ? prop.key.name : (prop.key.value);
        let local = null;
        if (prop.value.type === 'ArrowFunctionExpression') {
          const b = prop.value.body;
          if (b.type === 'Identifier') local = b.name;
          else if (b.type === 'MemberExpression') local = src.slice(b.start, b.end);
        } else if (prop.value.type === 'FunctionExpression') local = '[fn]';
        out.push({ name: String(key), local });
      }
    }
    for (const k in node) {
      if (k === 'start' || k === 'end' || k === 'type') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  }
  walk(body);
  return out;
}

const index = {};
for (const file of FILES) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  let parsed;
  try { parsed = parseModuleMap(src); }
  catch (e) { console.log(`${file}: PARSE ERROR ${e.message}`); continue; }
  const { mapNode, chunkId } = parsed;
  if (!mapNode) { console.log(`${file}: no module map found`); continue; }
  const mods = [];
  for (const prop of mapNode.properties) {
    if (prop.type !== 'Property') continue;
    const id = prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value);
    const val = prop.value;
    if (val.type !== 'ArrowFunctionExpression' && val.type !== 'FunctionExpression') continue;
    const args = (val.params || []).map(p => p.name || src.slice(p.start, p.end));
    const bodySrc = val.body.type === 'BlockStatement' ? src.slice(val.body.start + 1, val.body.end - 1) : src.slice(val.body.start, val.body.end);
    mods.push({ id, args, start: val.start, end: val.end, body: bodySrc, exports: getExportsFromAst(val, src) });
  }
  index[file] = { chunkId, count: mods.length, modules: mods.map(m => ({ id: m.id, args: m.args, bytes: m.body.length, exports: m.exports })) };
  // write bodies
  const sub = path.join(DIR, '_mod', file.replace('.js', ''));
  fs.mkdirSync(sub, { recursive: true });
  for (const m of mods) fs.writeFileSync(path.join(sub, `${m.id}.js`), m.body);
  console.log(`${file}: chunkId=${chunkId} modules=${mods.length}`);
}
fs.writeFileSync(path.join(DIR, '_index.json'), JSON.stringify(index, null, 2));
console.log('DONE');
