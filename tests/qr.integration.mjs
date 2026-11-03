// Run after npm install: npm run test:qr
import test from "node:test";
import assert from "node:assert/strict";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";
import { renderQrSvg } from "../lib/qr.js";
import { fixture } from "./helpers.mjs";

test("packaged encoder and camera decoder round-trip realistic signed links", async () => {
  const f = fixture();
  for (const point of ["start", "cp1", "cp2", "cp3"]) {
    const url = "https://walk.example.test/scan?token=" + f.qr(point);
    const qr = qrcode(0, "M");
    qr.addData(url); qr.make();
    assert.equal(await renderQrSvg(url), qr.createSvgTag(6, 24));
    const count = qr.getModuleCount(), scale = 6, margin = 4;
    const size = (count + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
        const offset = (((row + margin) * scale + y) * size + (col + margin) * scale + x) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
    }
    assert.equal(jsQR(pixels, size, size)?.data, url);
  }
});

test("authenticated QR endpoint generates SVG with expiry and strict no-cache headers", async () => {
  const f = fixture();
  for (const point of ["start", "cp1", "cp2", "cp3"]) {
    const result = await f.call("/api/qrcode.svg?point=" + point, { cookie: f.adminCookie });
    assert.equal(result.status, 200);
    assert.match(result.headers.get("Content-Type"), /image\/svg\+xml/);
    assert.equal(Number(result.headers.get("X-QR-Expires")) - Number(result.headers.get("X-QR-Server-Time")), 45);
    assert.match(result.headers.get("Cache-Control"), /no-store/);
    assert.match(await result.text(), /<svg/);
  }
});

test('shared staff link generates only its point QR and stops after revoke', async () => {
  const f=fixture();
  await f.call('/admin/qrs/share',{cookie:f.adminCookie,form:{point:'cp1',action:'create',days:1}});
  const html=await (await f.call('/admin/qrs',{cookie:f.adminCookie})).text();
  const url=new URL(html.match(/id="share-url-cp1" readonly value="([^"]+)"/)[1].replaceAll('&amp;','&'));
  const query='?point=cp1&share='+url.searchParams.get('share');
  const response=await f.call('/api/qrcode.svg'+query);
  assert.equal(response.status,200);
  assert.match(await response.text(),/<svg/);
  assert.equal(Number(response.headers.get('X-QR-Expires'))-Number(response.headers.get('X-QR-Server-Time')),45);
  await f.call('/admin/qrs/share',{cookie:f.adminCookie,form:{point:'cp1',action:'revoke'}});
  assert.equal((await f.call('/api/qrcode.svg'+query)).status,401);
});
