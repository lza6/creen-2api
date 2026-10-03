/**
 * 邮箱 API 连通性自检（真实调用）
 *   bun run src/tools/mail-check.ts
 *
 * 读取 config.local.json（或 config.json）的 mail_api 配置，验证：
 *   genToken → websiteConfig(域名) → allocateAddress → emailList → waitForCode
 * 密码可用环境变量 CREEN_MAIL_ADMIN_PASSWORD 覆盖。
 */

import { loadConfig } from "../core/config";
import { CloudMailClient } from "../core/mail-api";

async function main() {
  const cfg = loadConfig();
  const client = CloudMailClient.fromConfig(cfg);

  console.log("\n" + "=".repeat(64));
  console.log("  邮箱 API 自检（Cloud Mail）");
  console.log("=".repeat(64));

  if (!client) {
    console.error(
      "✗ 未配置 mail_api（需 enabled=true + api_base + admin_email + 密码）。\n" +
        "  请在 config.local.json 写入 mail_api，或用 CREEN_MAIL_ADMIN_PASSWORD 提供密码。"
    );
    process.exit(1);
  }

  // 1) genToken
  console.log("\n[1/4] 获取公钥 token…");
  const token = await client.getPublicToken();
  console.log("  ✓ token =", token.slice(0, 12) + "…");

  // 2) 域名列表
  console.log("\n[2/4] 拉取可用域名…");
  const domains = await client.getDomains();
  console.log("  ✓ 域名:", domains.join(", "));

  // 3) 分配地址
  console.log("\n[3/4] 生成 catch-all 地址…");
  const addr = await client.allocateAddress();
  console.log("  ✓ 地址:", addr);

  // 4) 查询该地址收件（通常为空，验证鉴权与通道即可）
  console.log("\n[4/4] 查询收件箱…");
  const list = await client.listEmails(addr, 5, 1);
  console.log(`  ✓ 连接正常，当前 ${list.length} 封`);

  // 额外：查询管理员邮箱收件（验证真实数据可读）
  console.log("\n[附加] 读取管理员邮箱收件（验证真实数据）…");
  const adminList = await client.listEmails(cfg.mail_api.admin_email, 3, 1);
  if (adminList.length) {
    const m = adminList[0];
    console.log(`  ✓ 最近一封: ${m.subject} · code=${m.code ?? "(无)"} · ${m.createTime}`);
  } else {
    console.log("  （管理员邮箱当前无邮件）");
  }

  console.log("\n" + "=".repeat(64));
  console.log("  ✓ 邮箱 API 对接正常");
  console.log("=".repeat(64) + "\n");
}

main().catch((e) => {
  console.error("\n✗ 自检失败:", (e as Error).message);
  process.exit(1);
});
