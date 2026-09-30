// 专项提取订阅/支付/定价体系
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "chunks");

const out = { fields: new Set(), keys: new Set(), values: new Set(), apiOps: new Set() };

for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".js"))) {
  const s = fs.readFileSync(path.join(DIR, f), "utf8");
  // 1. 订阅相关字段名
  for (const m of s.matchAll(/\b([a-z][a-zA-Z]*(?:Price|Goods|Vip|Subscription|Credits|Billing|Provider|Payment|Plan|Pack|Benefit|Channel|Trial|Expire)[a-zA-Z]*)\b/g)) {
    out.fields.add(m[1]);
  }
  // 2. i18n key（pricing/subscriptions/profile）
  for (const m of s.matchAll(/\(\"(pricing|subscriptions|profile|myAssets|explore)\.[a-zA-Z0-9_.]+\"\)/g)) {
    out.keys.add(m[1]);
  }
  // 3. 支付供应商
  for (const m of s.matchAll(/\"(stripe|dodo|google|ios|apple|paypal|alipay|wechat)\"/gi)) out.values.add(m[1].toLowerCase());
}

fs.writeFileSync(path.join(__dirname, "sub-fields.txt"), [...out.fields].sort().join("\n"));
console.log("=== 订阅相关字段 (" + out.fields.size + ") ===");
console.log([...out.fields].sort().join(", "));
console.log("\n=== i18n key 前缀 ===");
console.log([...out.keys].sort().join(", "));
console.log("\n=== 支付供应商 ===");
console.log([...out.values].sort().join(", "));
