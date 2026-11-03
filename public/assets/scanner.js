/* Camera only: no upload, paste-token, or click-to-complete path. */
(() => {
  "use strict";
  const panel = document.getElementById("scan-panel");
  if (!panel) return;
  const video = document.getElementById("scan-video");
  const canvas = document.getElementById("scan-canvas");
  const status = document.getElementById("scan-status");
  const title = document.getElementById("scan-title");
  const retry = document.getElementById("scan-retry");
  const close = document.getElementById("scan-close");
  const form = document.getElementById("scan-form");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const labels = { cp1: "点位一", cp2: "点位二", cp3: "点位三", start: "起点" };
  let stream = null, generation = 0, timer = null, point = null, opener = null;
  let submitting = false;

  function stop() {
    generation++;
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
  }
  function dismiss() {
    stop();
    panel.hidden = true;
    document.body.style.overflow = "";
    opener?.focus();
  }
  function fail(message) {
    stop();
    status.textContent = message;
    retry.hidden = false;
  }

  function accept(text) {
    // Do not navigate to arbitrary scanned URLs. Server verifies the signature,
    // expiry, point and participant before issuing an answer authorization.
    let scanned;
    try { scanned = new URL(text); } catch { return false; }
    if (scanned.origin !== location.origin || scanned.pathname !== "/scan" ||
        scanned.hash || scanned.searchParams.getAll("token").length !== 1) {
      status.textContent = "这不是本站的现场二维码，请对准当前点位的二维码。";
      return false;
    }
    const token = scanned.searchParams.get("token");
    if (!token || token.length > 4096) return false;
    submitting = true;
    form.elements.expected_point.value = point;
    form.elements.token.value = token;
    stop();
    status.textContent = "已识别，正在验证点位和有效期…";
    close.disabled = true;
    form.requestSubmit();
    return true;
  }

  function tick(id) {
    if (id !== generation || panel.hidden || submitting) return;
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "dontInvert" });
        if (code?.data && accept(code.data)) return;
      } catch {
        fail("无法读取摄像头画面，请关闭扫码后重试。");
        return;
      }
    }
    timer = setTimeout(() => tick(id), 160);
  }

  async function start(selected, button) {
    if (submitting || !Object.hasOwn(labels, selected)) return;
    stop();
    point = selected;
    opener = button || opener;
    const id = generation;
    panel.hidden = false;
    retry.hidden = true;
    document.body.style.overflow = "hidden";
    title.textContent = "扫描" + labels[point] + "现场二维码";
    status.textContent = "正在开启摄像头，请允许权限…";
    close.focus();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      fail("当前浏览器不能调用摄像头。请使用 HTTPS 地址，并在支持摄像头的浏览器中完成签到和扫码。");
      return;
    }
    if (typeof window.jsQR !== "function" || !ctx) {
      fail("扫码组件未加载，请刷新页面。如仍失败，请联系工作人员检查部署构建。");
      return;
    }
    try {
      const opened = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      // A permission prompt can outlive cancellation or a second card click.
      if (id !== generation || panel.hidden) {
        opened.getTracks().forEach(track => track.stop());
        return;
      }
      stream = opened;
      video.srcObject = stream;
      await video.play();
      if (id !== generation) return;
      status.textContent = "请对准" + labels[point] + "现场屏幕上正在刷新的二维码。";
      tick(id);
    } catch (error) {
      if (id !== generation) return;
      const message = error?.name === "NotAllowedError"
        ? "摄像头权限未开启。请在浏览器设置中允许摄像头，然后重试。"
        : error?.name === "NotFoundError"
          ? "没有找到摄像头，请使用带摄像头的手机。"
          : "摄像头无法开启，可能被其他应用占用或当前浏览器不支持。请关闭占用后重试。";
      fail(message);
    }
  }
  document.querySelectorAll("[data-scan-point]").forEach(button => {
    button.addEventListener("click", () => {
      if (!button.disabled) start(button.dataset.scanPoint, button);
    });
  });
  retry.addEventListener("click", () => start(point));
  close.addEventListener("click", dismiss);
  document.addEventListener("keydown", event => {
    if (panel.hidden) return;
    if (event.key === "Escape" && !submitting) dismiss();
    if (event.key === "Tab") {
      const buttons = retry.hidden ? [close] : [retry, close];
      const index = buttons.indexOf(document.activeElement);
      event.preventDefault();
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  });
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", event => {
    if (event.persisted) location.reload(); // refresh disabled/completed cards after back navigation
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !panel.hidden && !submitting) {
      fail("扫码已暂停。回到页面后点击重新开启摄像头。");
    }
  });
})();
