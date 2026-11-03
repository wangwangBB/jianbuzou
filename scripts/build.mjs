import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Missing dependencies must fail the build, never silently ship a broken scanner.
const jsqr = require.resolve("jsqr");
require.resolve("qrcode-generator");
const assets = resolve(root, "public/assets");
await mkdir(assets, { recursive: true });
await copyFile(jsqr, resolve(assets, "jsQR.js"));
await copyFile(resolve(dirname(require.resolve("jsqr/package.json")), "LICENSE"), resolve(assets, "jsQR.LICENSE.txt"));
const source = await readFile(resolve(assets, "jsQR.js"), "utf8");
if (!source.includes("jsQR")) throw new Error("jsQR browser bundle is invalid");
console.log("Build ready: same-origin QR scanner assets copied; QR generator resolved.");
