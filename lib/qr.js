// Kept outside functions/ so Pages does not treat this helper as a public route.
// Loaded only for the admin QR endpoint and bundled by Pages at deploy time.
export async function renderQrSvg(scanUrl) {
  const { default: qrcode } = await import("qrcode-generator");
  const qr = qrcode(0, "M");
  qr.addData(scanUrl);
  qr.make();
  return qr.createSvgTag(6, 24);
}
