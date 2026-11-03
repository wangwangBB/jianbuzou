import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/assets/scanner.js", import.meta.url), "utf8");
function cameraFixture({ denied = false, delayed = false, supported = true } = {}) {
  const events = new Map(), docEvents = new Map(), winEvents = new Map();
  const elements = {};
  let requests = 0, submits = 0, stops = 0, decoded = null, resolveCamera;
  const timers = new Map();
  let nextTimer = 0;
  function element(id) {
    return elements[id] = {
      hidden: false, disabled: false, style: {}, textContent: "", dataset: {},
      addEventListener(type, fn) { events.set(id + ":" + type, fn); },
      focus() { document.activeElement = this; },
      ...id === "scan-form" ? {
        elements: { expected_point: { value: "" }, token: { value: "" } },
        requestSubmit() { submits++; }
      } : {},
      ...id === "scan-video" ? { readyState: 2, videoWidth: 1280, videoHeight: 720, play: async () => {} } : {},
      ...id === "scan-canvas" ? { getContext: () => ({ drawImage() {}, getImageData: () => ({ data: [], width: 960, height: 540 }) }) } : {}
    };
  }
  for (const id of ["scan-panel", "scan-video", "scan-canvas", "scan-status", "scan-title", "scan-retry", "scan-close", "scan-form"]) element(id);
  elements["scan-panel"].hidden = true;
  const buttons = ["cp1", "cp2", "cp3"].map(point => { const b = element(point); b.dataset.scanPoint = point; return b; });
  const document = {
    body: { style: {} }, hidden: false, activeElement: null,
    getElementById: id => elements[id], querySelectorAll: () => buttons,
    addEventListener: (type, fn) => docEvents.set(type, fn)
  };
  const stream = { getTracks: () => [{ stop: () => stops++ }] };
  const window = { isSecureContext: supported, jsQR: () => decoded, addEventListener: (type, fn) => winEvents.set(type, fn) };
  const navigator = { mediaDevices: { getUserMedia: options => {
    requests++;
    assert.equal(options.audio, false);
    assert.equal(options.video.facingMode.ideal, "environment");
    if (denied) return Promise.reject({ name: "NotAllowedError" });
    if (delayed) return new Promise(resolve => { resolveCamera = resolve; });
    return Promise.resolve(stream);
  } } };
  const context = vm.createContext({ window, document, navigator, URL, location: { origin: "https://walk.example.test" },
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext(source, context);
  const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
  return {
    elements, document, stream, events, winEvents, docEvents,
    click: async id => { events.get(id + ":click")(); await flush(); },
    decode: value => { decoded = { data: value }; },
    frame: async () => { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); await flush(); },
    release: async () => { resolveCamera(stream); await flush(); }, flush,
    get requests() { return requests; }, get submits() { return submits; }, get stops() { return stops; }
  };
}

test("card clicks open camera only, never submit or complete a point", async () => {
  for (const point of ["cp1", "cp2", "cp3"]) {
    const f = cameraFixture();
    assert.equal(f.requests, 0);
    await f.click(point);
    assert.equal(f.requests, 1);
    assert.equal(f.submits, 0);
    assert.equal(f.elements["scan-panel"].hidden, false);
  }
});

test("camera decoded same-origin QR submits selected point separately and closes camera", async () => {
  const f = cameraFixture();
  await f.click("cp2");
  f.decode("https://walk.example.test/scan?token=signed-qr-token");
  await f.frame();
  assert.equal(f.submits, 1);
  assert.equal(f.elements["scan-form"].elements.expected_point.value, "cp2");
  assert.equal(f.elements["scan-form"].elements.token.value, "signed-qr-token");
  assert.equal(f.stops, 1);
  await f.frame();
  assert.equal(f.submits, 1);
});

test("external, javascript, duplicate token and non-scan URLs never navigate or submit", async () => {
  const f = cameraFixture();
  await f.click("cp1");
  for (const url of ["javascript:alert(1)", "https://evil.example/scan?token=a", "https://walk.example.test/admin", "https://walk.example.test/scan?token=a&token=b", "https://walk.example.test/scan?token=a#x", "not-a-url"]) {
    f.decode(url);
    await f.frame();
    assert.equal(f.submits, 0);
  }
});

test("cancelling permission prompt stops the late-arriving camera stream", async () => {
  const f = cameraFixture({ delayed: true });
  await f.click("cp1");
  await f.click("scan-close");
  await f.release();
  assert.equal(f.stops, 1);
  assert.equal(f.elements["scan-panel"].hidden, true);
  assert.equal(f.submits, 0);
});

test("permission denial and unsupported browser show actionable errors with no submit", async () => {
  for (const options of [{ denied: true }, { supported: false }]) {
    const f = cameraFixture(options);
    await f.click("cp1");
    assert.equal(f.elements["scan-retry"].hidden, false);
    assert.match(f.elements["scan-status"].textContent, /权限|浏览器/);
    assert.equal(f.submits, 0);
  }
});

test("cancel, page exit and backgrounding release camera", async () => {
  for (const event of ["cancel", "pagehide", "visibilitychange"]) {
    const f = cameraFixture();
    await f.click("cp1");
    if (event === "cancel") await f.click("scan-close");
    if (event === "pagehide") f.winEvents.get("pagehide")();
    if (event === "visibilitychange") { f.document.hidden = true; f.docEvents.get(event)(); }
    assert.equal(f.stops, 1);
    assert.equal(f.submits, 0);
  }
});

test("completed card cannot open camera", async () => {
  const f = cameraFixture();
  f.elements.cp1.disabled = true;
  await f.click("cp1");
  assert.equal(f.requests, 0);
  assert.equal(f.submits, 0);
});
