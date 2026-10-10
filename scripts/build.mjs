import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { resolve, join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
if (!dist.startsWith(root + sep)) throw new Error("Build output escaped the site checkout.");
const source = readFileSync(join(root, "worker/index.js"), "utf8");
const styles = readFileSync(join(root, "worker/styles.css"), "utf8");
const client = readFileSync(join(root, "worker/client.js"), "utf8");
if (!source.includes('"__STYLES__"') || !source.includes('"__CLIENT__"')) throw new Error("Missing build placeholders.");
const bundled = source.replace('"__STYLES__"', JSON.stringify(styles)).replace('"__CLIENT__"', JSON.stringify(client));
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "server"), { recursive: true });
writeFileSync(join(dist, "server/index.js"), bundled);
const sitesHosting = join(root, ".openai/hosting.json");
if (existsSync(sitesHosting)) {
  mkdirSync(join(dist, ".openai"), { recursive: true });
  copyFileSync(sitesHosting, join(dist, ".openai/hosting.json"));
}
console.log(`Built ${dist}`);
