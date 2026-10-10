import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { resolve, join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { feedbackAssets } from "./feedback-assets.mjs";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
if (!dist.startsWith(root + sep)) throw new Error("Build output escaped the site checkout.");
const source = readFileSync(join(root, "worker/index.js"), "utf8");
const styles = readFileSync(join(root, "worker/styles.css"), "utf8");
const client = readFileSync(join(root, "worker/client.js"), "utf8");
const openingScript = readFileSync(join(root, "worker/opening.js"), "utf8");
const openingBackground = readFileSync(join(root, "assets/loading-background.jpg"));
const openingBackgroundPath = `/assets/opening-bg-${createHash("sha256").update(openingBackground).digest("hex").slice(0, 12)}.jpg`;
const feedback = feedbackAssets(root);
if (!feedback.length || !source.includes('"__STYLES__"') || !source.includes('"__CLIENT__"') || !source.includes('"__OPENING_SCRIPT__"') || !source.includes('"__FEEDBACK_IMAGES__"') || !source.includes('"__OPENING_BG__"') || !source.includes('"__OPENING_BG_PATH__"') || !styles.includes('__OPENING_BG_PATH__')) throw new Error("Missing opening assets or build placeholders.");
const bundled = source.replace('"__STYLES__"', JSON.stringify(styles.replaceAll('__OPENING_BG_PATH__', openingBackgroundPath))).replace('"__CLIENT__"', JSON.stringify(client)).replace('"__OPENING_SCRIPT__"', JSON.stringify(openingScript)).replace('"__OPENING_BG__"', JSON.stringify(openingBackground.toString('base64'))).replace('"__OPENING_BG_PATH__"', JSON.stringify(openingBackgroundPath)).replace('"__FEEDBACK_IMAGES__"', JSON.stringify(feedback.map(({ name, width, height, path, bytes }) => ({ name, width, height, path, base64: bytes.toString('base64') }))));
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "server"), { recursive: true });
writeFileSync(join(dist, "server/index.js"), bundled);
const sitesHosting = join(root, ".openai/hosting.json");
if (existsSync(sitesHosting)) {
  mkdirSync(join(dist, ".openai"), { recursive: true });
  copyFileSync(sitesHosting, join(dist, ".openai/hosting.json"));
}
console.log(`Built ${dist}`);
