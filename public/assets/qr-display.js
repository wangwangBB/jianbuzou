(() => {
  "use strict";
  const ttl = Number(document.currentScript.dataset.ttl) || 45;
  const refreshMs = Math.min(20000, Math.floor(ttl * 1000 / 2));
  const images = [...document.querySelectorAll(".live-qr")];
  const states = images.map(img => ({ img, expires: 0, blob: null, pending: false }));
  const countdown = document.getElementById("countdown");
  for (const state of states) {
    const message = document.createElement("p");
    message.setAttribute("role", "status");
    state.img.after(message);
    state.message = message;
    state.img.hidden = true;
  }
  async function refresh(state) {
    if (state.pending) return;
    state.pending = true;
    const controller = new AbortController();
    const started = performance.now();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("/api/qrcode.svg?point=" + encodeURIComponent(state.img.dataset.point) + "&_=" + Date.now(), {
        cache: "no-store", credentials: "same-origin", signal: controller.signal
      });
      if (!response.ok || !response.headers.get("Content-Type")?.includes("image/svg+xml")) throw new Error("qr");
      // Subtract one second for the server's integer-second clock precision.
      const remaining = (Number(response.headers.get("X-QR-Expires")) - Number(response.headers.get("X-QR-Server-Time")) - 1) * 1000;
      const blob = await response.blob();
      const expires = started + remaining; // conservatively include network time
      if (!remaining || expires <= performance.now()) throw new Error("expired");
      const next = URL.createObjectURL(blob);
      if (state.blob) URL.revokeObjectURL(state.blob);
      state.blob = next;
      state.expires = expires;
      state.img.src = next;
      state.img.hidden = false;
      state.message.textContent = "现场动态码 · 自动刷新中";
    } catch {
      state.message.textContent = "二维码刷新失败，请检查网络或重新登录后台。";
    } finally {
      clearTimeout(timeout);
      state.pending = false;
    }
  }
  function tick() {
    for (const state of states) {
      const seconds = Math.max(0, Math.ceil((state.expires - performance.now()) / 1000));
      if (!seconds) {
        state.img.hidden = true;
        state.message.textContent = "二维码暂不可用，等待刷新；请检查网络和后台登录。";
      }
      if (countdown) countdown.textContent = seconds ? `当前二维码剩余 ${seconds} 秒有效` : "等待新的现场二维码";
    }
  }
  const refreshAll = () => states.forEach(state => refresh(state));
  refreshAll();
  setInterval(refreshAll, refreshMs);
  setInterval(tick, 500);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAll(); });
  window.addEventListener("pagehide", () => states.forEach(state => { if (state.blob) URL.revokeObjectURL(state.blob); }));
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
})();
