const POINTS = {
  start: { code: "start", label: "起点签到 / 签退", short: "起点" },
  cp1: { code: "cp1", label: "一号打点点位", short: "点位一" },
  cp2: { code: "cp2", label: "二号打点点位", short: "点位二" },
  cp3: { code: "cp3", label: "三号打点点位", short: "点位三" }
};
const CHECKPOINTS = ["cp1", "cp2", "cp3"];
const DEPARTMENTS = [
  "公司领导",
  "党群与综合部",
  "人力资源部",
  "市场营销与经营管理部",
  "新能源部（业务发展部）",
  "财务部",
  "采购与合同管理部",
  "生产技术部",
  "安健环管理部",
  "发电运行部",
  "设备维护部",
  "海水淡化部",
  "燃料管理部",
  "北疆环科",
  "北疆能源销售"
];
let phoneColumnReady = false;
const DEFAULT_ADMIN_PASSWORD = "admin123456";
const DEFAULT_QR_SECRET = "dev-secret-change-me";

export async function handleRequest(request, env) {
  try {
    return await router(request, env);
  } catch (err) {
    console.error(err);
    return htmlPage("系统错误", `<div class="card danger"><h2>系统错误</h2><p>${escapeHtml(err?.message || String(err))}</p></div>`, 500, env);
  }
}

async function router(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  await ensureParticipantPhoneColumn(env);

  if (path === "/") return redirect("/admin");
  if (path === "/health") return json({ ok: true, time: nowIso() });
  if (path === "/clear-session") return clearParticipantSession(request, env);

  if (path === "/admin/login" && request.method === "GET") return adminLoginPage(env);
  if (path === "/admin/login" && request.method === "POST") return adminLoginPost(request, env);
  if (path === "/admin/logout") return adminLogout(request, env);

  if (path.startsWith("/admin")) {
    if (!(await isAdmin(request, env))) {
      return redirect(`/admin/login?next=${encodeURIComponent(path + url.search)}`);
    }
  }

  if (path === "/api/qrcode.svg") {
    const point = url.searchParams.get("point") || "";
    if (!(await canViewQr(request, env, point))) return new Response("Unauthorized", { status: 401 });
  }

  if (path === "/admin" && request.method === "GET") return adminDashboard(request, env);
  if (path === "/admin/qrs" && request.method === "GET") return adminQrList(request, env);
  if (path.startsWith("/display/") && request.method === "GET") return displayQrPage(request, env, path.split("/")[2]);
  if (path === "/api/qrcode.svg" && request.method === "GET") return apiQrSvg(request, env);
  if (path === "/admin/questions" && request.method === "GET") return adminQuestions(request, env);
  if (path === "/admin/questions" && request.method === "POST") return adminQuestionCreate(request, env);
  if (path === "/admin/questions/delete" && request.method === "POST") return adminQuestionDelete(request, env);
  if (path === "/admin/participant" && request.method === "GET") return adminParticipantDetail(request, env);
  if (path === "/admin/participants/delete" && request.method === "POST") return adminParticipantDelete(request, env);
  if (path === "/admin/participants/clear" && request.method === "POST") return adminParticipantsClear(request, env);
  if (path === "/admin/export.csv" && request.method === "GET") return adminExportCsv(request, env);

  if (path === "/scan" && request.method === "GET") return scan(request, env);
  if (path === "/checkin" && request.method === "POST") return checkinPost(request, env);
  if (path === "/checkin/confirm" && request.method === "POST") return checkinConfirmPost(request, env);
  if (path === "/answer" && request.method === "POST") return answerPost(request, env);
  if (path === "/checkout" && request.method === "POST") return checkoutPost(request, env);

  return htmlPage("未找到页面", `<div class="card"><h2>未找到页面</h2><p>请确认访问地址是否正确。</p></div>`, 404, env);
}

async function scan(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const qr = await verifyToken(token, secret(env));
  if (!qr || qr.kind !== "qr" || !POINTS[qr.point]) return expiredPage(env);

  if (qr.point === "start") return startScanPage(request, env);
  return checkpointScanPage(request, env, qr.point);
}

async function startScanPage(request, env) {
  const participant = await getParticipantFromCookie(request, env);
  const title = env.EVENT_TITLE || "健步走签到打点系统";

  if (!participant) {
    const actionToken = await signToken({ kind: "checkin", exp: unixNow() + actionTtl(env), nonce: crypto.randomUUID() }, secret(env));
    return htmlPage("起点签到", `
      <div class="hero"><div class="badge">${escapeHtml(title)}</div><h1>起点签到</h1><p>请填写本人信息后开始比赛。完成任意一个点位扫码答题后，即可回到起点扫码签退。</p></div>
      <form class="card" method="post" action="/checkin">
        <input type="hidden" name="action_token" value="${escapeAttr(actionToken)}">
        <label>选手姓名<input name="name" required maxlength="30" placeholder="请输入姓名" autocomplete="name"></label>
        <label>手机号<input name="phone" required maxlength="20" placeholder="请输入手机号" autocomplete="tel" inputmode="tel"></label>
        <label>部门<select name="department" required><option value="">请选择部门</option>${departmentOptions()}</select></label>
        <button class="primary" type="submit">下一步：确认个人信息</button>
      </form>
    `, 200, env);
  }

  const progress = await getProgress(env, participant.id);
  if (participant.checkout_at) {
    return participantDonePage(participant, progress, env);
  }

  if (progress.doneCount < 1) {
    return htmlPage("已签到", `
      <div class="hero"><div class="badge">${escapeHtml(title)}</div><h1>已完成起点签到</h1><p>${escapeHtml(participant.name)}，请至少完成任意一个点位的扫码打点和答题。</p></div>
      ${progressCard(progress)}
      <div class="card muted"><p>完成任意一个点位后，即可回到起点扫码签退。</p><p><a href="/clear-session">不是本人？清除本机签到信息</a></p></div>
    `, 200, env);
  }

  const checkoutToken = await signToken({ kind: "checkout", pid: participant.id, exp: unixNow() + actionTtl(env), nonce: crypto.randomUUID() }, secret(env));
  return htmlPage("起点签退", `
    <div class="hero"><div class="badge">${escapeHtml(title)}</div><h1>可以签退</h1><p>${escapeHtml(participant.name)}，你已完成至少一个点位打点及答题记录，已满足签退条件。</p></div>
    ${progressCard(progress)}
    <form class="card" method="post" action="/checkout">
      <input type="hidden" name="action_token" value="${escapeAttr(checkoutToken)}">
      <button class="success" type="submit">确认签退，完成比赛</button>
    </form>
  `, 200, env);
}

async function checkpointScanPage(request, env, point) {
  const participant = await getParticipantFromCookie(request, env);
  if (!participant) {
    return htmlPage("请先签到", `
      <div class="card warning"><h2>请先到起点签到</h2><p>系统未识别到你的起点签到信息。请使用同一部手机先扫描起点二维码完成签到。</p></div>
    `, 200, env);
  }

  if (participant.checkout_at) return participantDonePage(participant, await getProgress(env, participant.id), env);

  await env.DB.prepare("UPDATE participants SET last_seen_at = ? WHERE id = ?").bind(nowIso(), participant.id).run();

  const existing = await env.DB.prepare("SELECT * FROM checkpoint_records WHERE participant_id = ? AND point_code = ?")
    .bind(participant.id, point).first();
  const progress = await getProgress(env, participant.id);
  if (existing) {
    return htmlPage("已完成该点位", `
      <div class="card success-card"><h2>${escapeHtml(POINTS[point].label)}已完成</h2><p>你已在该点位完成打点和答题，请勿重复提交。</p></div>
      ${progressCard(progress)}
    `, 200, env);
  }

  const question = await env.DB.prepare(`
    SELECT * FROM questions
    WHERE enabled = 1 AND (point_code = ? OR point_code = 'ALL')
    ORDER BY RANDOM()
    LIMIT 1
  `).bind(point).first();

  if (!question) {
    return htmlPage("题库为空", `<div class="card danger"><h2>题库为空</h2><p>该点位没有可用题目，请联系工作人员在后台添加题目。</p></div>`, 200, env);
  }

  const answerToken = await signToken({ kind: "answer", pid: participant.id, point, qid: question.id, exp: unixNow() + actionTtl(env), nonce: crypto.randomUUID() }, secret(env));
  return htmlPage(`${POINTS[point].short}答题`, `
    <div class="hero"><div class="badge">${escapeHtml(POINTS[point].label)}</div><h1>扫码打点成功</h1><p>${escapeHtml(participant.name)}，请完成本点位随机题目。</p></div>
    <form class="card quiz" method="post" action="/answer">
      <input type="hidden" name="answer_token" value="${escapeAttr(answerToken)}">
      <h2>${escapeHtml(question.title)}</h2>
      ${optionRadio("A", question.option_a)}
      ${optionRadio("B", question.option_b)}
      ${optionRadio("C", question.option_c)}
      ${optionRadio("D", question.option_d)}
      <button class="primary" type="submit">提交答案并完成打点</button>
    </form>
  `, 200, env);
}

async function checkinPost(request, env) {
  const form = await request.formData();
  const actionToken = String(form.get("action_token") || "");
  const payload = await verifyToken(actionToken, secret(env));
  if (!payload || payload.kind !== "checkin") return expiredPage(env);

  const name = cleanText(form.get("name"), 30);
  const phone = cleanText(form.get("phone"), 20);
  const department = cleanText(form.get("department"), 60);

  if (!name || !phone || !department) {
    return htmlPage("信息不完整", `<div class="card warning"><h2>信息不完整</h2><p>请填写选手姓名、手机号并选择部门。</p></div>`, 400, env);
  }
  if (!isValidPhone(phone)) {
    return htmlPage("手机号格式不正确", `<div class="card warning"><h2>手机号格式不正确</h2><p>请返回检查手机号，建议填写 11 位手机号。</p></div>`, 400, env);
  }
  if (!DEPARTMENTS.includes(department)) {
    return htmlPage("部门选择错误", `<div class="card warning"><h2>部门选择错误</h2><p>请从下拉菜单中选择规范部门。</p></div>`, 400, env);
  }

  const confirmToken = await signToken({
    kind: "checkin_confirm",
    name,
    phone,
    department,
    exp: unixNow() + actionTtl(env),
    nonce: crypto.randomUUID()
  }, secret(env));

  return htmlPage("确认个人信息", `
    <div class="hero"><div class="badge">起点签到</div><h1>请确认个人信息</h1><p>请认真核对姓名、手机号和部门。确认后将正式完成签到。</p></div>
    <div class="card info-card">
      <div class="confirm-row"><span>姓名</span><b>${escapeHtml(name)}</b></div>
      <div class="confirm-row"><span>手机号</span><b>${escapeHtml(phone)}</b></div>
      <div class="confirm-row"><span>部门</span><b>${escapeHtml(department)}</b></div>
    </div>
    <form class="card" method="post" action="/checkin/confirm">
      <input type="hidden" name="confirm_token" value="${escapeAttr(confirmToken)}">
      <button class="success" type="submit">信息无误，确认签到</button>
      <button class="secondary" type="button" onclick="history.back()">返回修改</button>
    </form>
  `, 200, env);
}

async function checkinConfirmPost(request, env) {
  const form = await request.formData();
  const confirmToken = String(form.get("confirm_token") || "");
  const payload = await verifyToken(confirmToken, secret(env));
  if (!payload || payload.kind !== "checkin_confirm") return expiredPage(env);

  const name = cleanText(payload.name, 30);
  const phone = cleanText(payload.phone, 20);
  const department = cleanText(payload.department, 60);
  if (!name || !phone || !department || !isValidPhone(phone) || !DEPARTMENTS.includes(department)) {
    return htmlPage("信息校验失败", `<div class="card warning"><h2>信息校验失败</h2><p>请重新扫描起点二维码填写签到信息。</p></div>`, 400, env);
  }

  const existing = await env.DB.prepare(`
    SELECT * FROM participants
    WHERE name = ? AND phone = ? AND department = ? AND checkout_at IS NULL
    ORDER BY checkin_at DESC
    LIMIT 1
  `).bind(name, phone, department).first();

  let participant;
  if (existing) {
    participant = existing;
  } else {
    const id = crypto.randomUUID();
    const now = nowIso();
    const userAgent = request.headers.get("User-Agent") || "";
    await env.DB.prepare(`
      INSERT INTO participants (id, name, phone, department, checkin_at, created_at, user_agent, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, name, phone, department, now, now, userAgent.slice(0, 300), now).run();
    participant = await env.DB.prepare("SELECT * FROM participants WHERE id = ?").bind(id).first();
  }

  const cookie = await participantCookie(participant.id, env, request);
  return htmlPage("签到成功", `
    <div class="hero"><div class="badge">签到成功</div><h1>${escapeHtml(participant.name)}，签到成功</h1><p>请按路线前往任意点位扫码打点并完成答题；完成任意一个点位后即可回起点签退。</p></div>
    <div class="card muted"><p>手机号：${escapeHtml(participant.phone || "")}<br>部门：${escapeHtml(participant.department || "")}</p></div>
    ${progressCard(await getProgress(env, participant.id))}
  `, 200, env, { "Set-Cookie": cookie });
}

async function answerPost(request, env) {
  const form = await request.formData();
  const answerToken = String(form.get("answer_token") || "");
  const payload = await verifyToken(answerToken, secret(env));
  if (!payload || payload.kind !== "answer" || !CHECKPOINTS.includes(payload.point)) return expiredPage(env);

  const participant = await getParticipantFromCookie(request, env);
  if (!participant || participant.id !== payload.pid) {
    return htmlPage("身份不匹配", `<div class="card warning"><h2>身份不匹配</h2><p>请使用本人签到时的手机扫码答题。</p></div>`, 403, env);
  }
  if (participant.checkout_at) return participantDonePage(participant, await getProgress(env, participant.id), env);

  const selected = String(form.get("selected_option") || "").toUpperCase();
  if (!["A", "B", "C", "D"].includes(selected)) {
    return htmlPage("请选择答案", `<div class="card warning"><h2>请选择答案</h2><p>请返回选择一个答案后提交。</p></div>`, 400, env);
  }

  const existing = await env.DB.prepare("SELECT id FROM checkpoint_records WHERE participant_id = ? AND point_code = ?")
    .bind(participant.id, payload.point).first();
  if (existing) {
    return htmlPage("已完成该点位", `${progressCard(await getProgress(env, participant.id))}`, 200, env);
  }

  const q = await env.DB.prepare("SELECT * FROM questions WHERE id = ? AND enabled = 1").bind(payload.qid).first();
  if (!q) {
    return htmlPage("题目失效", `<div class="card danger"><h2>题目失效</h2><p>该题目已被删除或禁用，请重新扫描点位二维码。</p></div>`, 400, env);
  }
  const isCorrect = selected === q.correct_option ? 1 : 0;
  await env.DB.prepare(`
    INSERT INTO checkpoint_records (participant_id, point_code, question_id, question_title, selected_option, correct_option, is_correct, answered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(participant.id, payload.point, q.id, q.title, selected, q.correct_option, isCorrect, nowIso()).run();

  const progress = await getProgress(env, participant.id);
  const nextText = progress.doneCount >= 1 ? "已完成至少一个点位，已满足签退条件，请回到起点扫码签退。" : `还需完成任意一个点位。`;
  return htmlPage("提交成功", `
    <div class="card success-card"><h2>${escapeHtml(POINTS[payload.point].label)}打点完成</h2><p>答案已提交，后台已记录本次打点及答题信息。</p><p>${escapeHtml(nextText)}</p></div>
    ${progressCard(progress)}
  `, 200, env);
}

async function checkoutPost(request, env) {
  const form = await request.formData();
  const actionToken = String(form.get("action_token") || "");
  const payload = await verifyToken(actionToken, secret(env));
  if (!payload || payload.kind !== "checkout") return expiredPage(env);

  const participant = await getParticipantFromCookie(request, env);
  if (!participant || participant.id !== payload.pid) {
    return htmlPage("身份不匹配", `<div class="card warning"><h2>身份不匹配</h2><p>请使用本人签到时的手机完成签退。</p></div>`, 403, env);
  }

  const progress = await getProgress(env, participant.id);
  if (progress.doneCount < 1) {
    return htmlPage("暂不能签退", `
      <div class="card warning"><h2>暂不能签退</h2><p>必须至少完成任意一个点位的扫码打点及答题记录后，才可以签退。</p></div>
      ${progressCard(progress)}
    `, 200, env);
  }

  const t = nowIso();
  await env.DB.prepare("UPDATE participants SET checkout_at = COALESCE(checkout_at, ?), completed_at = COALESCE(completed_at, ?), last_seen_at = ? WHERE id = ?")
    .bind(t, t, t, participant.id).run();
  const updated = await env.DB.prepare("SELECT * FROM participants WHERE id = ?").bind(participant.id).first();
  return participantDonePage(updated, await getProgress(env, participant.id), env);
}

function expiredPage(env) {
  return htmlPage("二维码已过期", `
    <div class="card warning"><h2>二维码已过期或无效</h2><p>请重新扫描现场正在显示的动态二维码。</p></div>
  `, 400, env);
}

function participantDonePage(participant, progress, env) {
  return htmlPage("比赛完成", `
    <div class="hero success-hero"><div class="badge">比赛完成</div><h1>${escapeHtml(participant.name)}，已完成比赛</h1><p>签到：${fmt(participant.checkin_at)}<br>签退：${fmt(participant.checkout_at || participant.completed_at)}</p></div>
    ${progressCard(progress)}
    <div class="card muted"><p><a href="/clear-session">清除本机签到信息</a></p></div>
  `, 200, env);
}

async function adminLoginPage(env) {
  const warn = !env.ADMIN_PASSWORD ? `<p class="small danger-text">当前未设置 ADMIN_PASSWORD Secret，临时默认密码为 admin123456。部署正式活动前务必修改。</p>` : "";
  return htmlPage("后台登录", `
    <div class="hero"><div class="badge">后台管理</div><h1>健步走后台登录</h1><p>登录后可查看动态二维码、选手记录和题库。</p></div>
    <form class="card" method="post" action="/admin/login">
      <label>后台密码<input type="password" name="password" required autocomplete="current-password" placeholder="请输入后台密码"></label>
      <button class="primary" type="submit">登录</button>
      ${warn}
    </form>
  `, 200, env);
}

async function adminLoginPost(request, env) {
  const form = await request.formData();
  const password = String(form.get("password") || "");
  const expected = env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  if (password !== expected) {
    return htmlPage("登录失败", `<div class="card danger"><h2>密码错误</h2><p>请返回重新输入。</p></div>`, 403, env);
  }
  const token = await signToken({ kind: "admin", exp: unixNow() + 7 * 24 * 3600, nonce: crypto.randomUUID() }, adminSecret(env));
  return redirect("/admin", { "Set-Cookie": `admin_session=${token}; ${cookieAttrs(request)}; Max-Age=${7 * 24 * 3600}` });
}

function adminLogout(request) {
  return redirect("/admin/login", { "Set-Cookie": `admin_session=; ${cookieAttrs(request)}; Max-Age=0` });
}

async function adminDashboard(request, env) {
  const rows = await env.DB.prepare(`
    SELECT p.id, p.name, p.phone, p.department, p.checkin_at, p.checkout_at, p.completed_at,
      MAX(CASE WHEN r.point_code = 'cp1' THEN r.answered_at END) AS cp1_at,
      MAX(CASE WHEN r.point_code = 'cp2' THEN r.answered_at END) AS cp2_at,
      MAX(CASE WHEN r.point_code = 'cp3' THEN r.answered_at END) AS cp3_at,
      COUNT(r.id) AS answered_count,
      COALESCE(SUM(r.is_correct), 0) AS correct_count
    FROM participants p
    LEFT JOIN checkpoint_records r ON p.id = r.participant_id
    GROUP BY p.id
    ORDER BY p.checkin_at DESC
    LIMIT 1000
  `).all();
  const list = rows.results || [];
  const stats = {
    total: list.length,
    completed: list.filter(r => r.checkout_at).length,
    onRoad: list.filter(r => !r.checkout_at).length
  };

  const body = `
    ${adminNav("dashboard")}
    <div class="stats">
      <div><b>${stats.total}</b><span>已签到</span></div>
      <div><b>${stats.onRoad}</b><span>进行中</span></div>
      <div><b>${stats.completed}</b><span>已完成</span></div>
    </div>
    <div class="card table-card">
      <div class="table-head"><h2>选手记录</h2><div class="table-actions"><a class="button" href="/admin/export.csv">导出 CSV</a><form method="post" action="/admin/participants/clear" onsubmit="return confirm('确定清空全部选手签到、打点和签退记录吗？题库不会删除。')"><button class="danger-button" type="submit">清空选手数据</button></form></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>姓名</th><th>手机号</th><th>部门</th><th>签到</th><th>点位一</th><th>点位二</th><th>点位三</th><th>正确数</th><th>签退 / 状态</th><th>操作</th></tr></thead>
        <tbody>${list.map(r => `
          <tr>
            <td><a href="/admin/participant?id=${encodeURIComponent(r.id)}">${escapeHtml(r.name)}</a></td>
            <td>${escapeHtml(r.phone || "")}</td>
            <td>${escapeHtml(r.department)}</td>
            <td>${fmt(r.checkin_at)}</td>
            <td>${statusCell(r.cp1_at)}</td>
            <td>${statusCell(r.cp2_at)}</td>
            <td>${statusCell(r.cp3_at)}</td>
            <td>${Number(r.correct_count || 0)} / ${Number(r.answered_count || 0)}</td>
            <td>${r.checkout_at ? `<span class="pill ok">已完成</span><br>${fmt(r.checkout_at)}` : `<span class="pill doing">进行中</span>`}</td>
            <td><form method="post" action="/admin/participants/delete" onsubmit="return confirm('确定删除该选手及其打点、答题、签退记录吗？')"><input type="hidden" name="id" value="${escapeAttr(r.id)}"><button class="linkbtn" type="submit">删除</button></form></td>
          </tr>`).join("") || `<tr><td colspan="10" class="empty">暂无签到记录</td></tr>`}</tbody>
      </table></div>
    </div>
  `;
  return htmlPage("后台管理", body, 200, env);
}

async function adminParticipantDetail(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const p = await env.DB.prepare("SELECT * FROM participants WHERE id = ?").bind(id).first();
  if (!p) return htmlPage("未找到选手", `${adminNav()}<div class="card warning"><h2>未找到选手</h2></div>`, 404, env);
  const recs = await env.DB.prepare(`
    SELECT * FROM checkpoint_records WHERE participant_id = ? ORDER BY answered_at ASC
  `).bind(id).all();
  const progress = await getProgress(env, id);
  return htmlPage("选手详情", `
    ${adminNav("dashboard")}
    <div class="card">
      <h2>${escapeHtml(p.name)} · ${escapeHtml(p.department)}</h2>
      <p>手机号：${escapeHtml(p.phone || "")}<br>签到时间：${fmt(p.checkin_at)}<br>签退时间：${fmt(p.checkout_at)}<br>完成状态：${p.checkout_at ? "已完成" : "进行中"}</p>
      <form method="post" action="/admin/participants/delete" onsubmit="return confirm('确定删除该选手及其打点、答题、签退记录吗？')"><input type="hidden" name="id" value="${escapeAttr(p.id)}"><button class="danger-button" type="submit">删除该选手数据</button></form>
    </div>
    ${progressCard(progress)}
    <div class="card table-card"><h2>答题记录</h2><div class="table-wrap"><table>
      <thead><tr><th>点位</th><th>题目</th><th>选择</th><th>正确答案</th><th>结果</th><th>时间</th></tr></thead>
      <tbody>${(recs.results || []).map(r => `<tr><td>${escapeHtml(POINTS[r.point_code]?.short || r.point_code)}</td><td>${escapeHtml(r.question_title)}</td><td>${escapeHtml(r.selected_option)}</td><td>${escapeHtml(r.correct_option)}</td><td>${r.is_correct ? "正确" : "错误"}</td><td>${fmt(r.answered_at)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">暂无答题记录</td></tr>`}</tbody>
    </table></div></div>
  `, 200, env);
}

async function adminParticipantDelete(request, env) {
  const f = await request.formData();
  const id = cleanText(f.get("id"), 80);
  if (!id) return redirect("/admin");
  await env.DB.prepare("DELETE FROM checkpoint_records WHERE participant_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM participants WHERE id = ?").bind(id).run();
  return redirect("/admin");
}

async function adminParticipantsClear(request, env) {
  await env.DB.prepare("DELETE FROM checkpoint_records").run();
  await env.DB.prepare("DELETE FROM participants").run();
  return redirect("/admin");
}

async function adminQrList(request, env) {
  const origin = new URL(request.url).origin;
  const cards = Object.values(POINTS).map(p => {
    const key = pointKey(env, p.code);
    const staffUrl = key ? `${origin}/display/${p.code}?k=${encodeURIComponent(key)}` : "";
    return `
    <div class="qr-mini-card">
      <h2>${escapeHtml(p.label)}</h2>
      <p class="small">点位专属链接：${key ? "已配置" : "未配置，仅管理员可打开"}</p>
      <img class="live-qr" data-point="${p.code}" alt="${escapeAttr(p.label)}二维码">
      <a class="button" href="/display/${p.code}" target="_blank">管理员打开大屏二维码</a>
      ${staffUrl ? `<p class="small">发给工作人员的链接：</p><input readonly value="${escapeAttr(staffUrl)}" onclick="this.select()"><a class="button secondary" href="${escapeAttr(staffUrl)}" target="_blank">打开专属链接</a>` : `<p class="small danger-text">请先设置 ${escapeHtml(pointKeyEnvName(p.code))}</p>`}
    </div>
  `;
  }).join("");
  return htmlPage("动态二维码", `
    ${adminNav("qrs")}
    <div class="card muted"><p>二维码短时有效，页面会自动刷新。请分别在起点、三个点位打开对应二维码页面；选手完成任意一个点位即可回起点签退。</p><p>为防止非本点位人员打开二维码，可在 Cloudflare Pages 环境变量中分别设置 QR_KEY_START、QR_KEY_CP1、QR_KEY_CP2、QR_KEY_CP3，然后把后台生成的专属链接发给对应点位工作人员。</p></div>
    <div class="qr-grid">${cards}</div>
    <script>${clientQrRefreshScript()}</script>
  `, 200, env);
}

async function displayQrPage(request, env, point) {
  if (!POINTS[point]) return htmlPage("点位不存在", `<div class="card warning"><h2>点位不存在</h2></div>`, 404, env);
  if (!(await canViewQr(request, env, point))) return displayKeyDeniedPage(env, point);
  return htmlPage(POINTS[point].label, `
    <main class="display-page">
      <div class="display-title">${escapeHtml(env.EVENT_TITLE || "健步走签到打点系统")}</div>
      <h1>${escapeHtml(POINTS[point].label)}</h1>
      <img class="display-qr live-qr" data-point="${point}" alt="${escapeAttr(POINTS[point].label)}二维码">
      <p id="countdown">二维码自动刷新中</p>
      <p class="small">请使用本人手机扫码。二维码过期后请重新扫描现场最新二维码。</p>
    </main>
    <script>${clientQrRefreshScript()}</script>
  `, 200, env, {}, true);
}

function displayKeyDeniedPage(env, point) {
  const envName = pointKeyEnvName(point);
  return htmlPage("无权打开二维码", `
    <div class="card warning"><h2>无权打开该点位二维码</h2><p>${escapeHtml(POINTS[point].label)} 需要使用点位专属链接打开。</p><p class="small">请确认链接中包含正确的 <code>k=</code> 密钥；如未配置，请在 Cloudflare Pages 环境变量中设置 ${escapeHtml(envName)}。</p></div>
  `, 403, env);
}

async function apiQrSvg(request, env) {
  const url = new URL(request.url);
  const point = url.searchParams.get("point") || "";
  if (!POINTS[point]) return new Response("Bad point", { status: 400 });
  const ttl = qrTtl(env);
  const token = await signToken({ kind: "qr", point, exp: unixNow() + ttl, nonce: crypto.randomUUID() }, secret(env));
  const scanUrl = `${url.origin}/scan?token=${encodeURIComponent(token)}`;

  // Cloudflare Pages Functions 的构建环境有时不会安装 npm 依赖。
  // 为了让项目在 Pages 上更稳，二维码图片由在线二维码接口生成，
  // 本系统只负责生成短时有效、带签名的扫码链接。
  const qrApi = "https://api.qrserver.com/v1/create-qr-code/?" + new URLSearchParams({
    size: "560x560",
    format: "svg",
    margin: "1",
    data: scanUrl
  }).toString();

  const qrResp = await fetch(qrApi, {
    headers: { "User-Agent": "walk-qr-cloudflare-pages/1.0" }
  });

  if (!qrResp.ok) {
    return new Response(fallbackQrSvg(scanUrl), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
      }
    });
  }

  return new Response(qrResp.body, {
    headers: {
      "Content-Type": qrResp.headers.get("Content-Type") || "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
    }
  });
}

function fallbackQrSvg(scanUrl) {
  const safeUrl = escapeHtml(scanUrl);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="560" viewBox="0 0 560 560">
    <rect width="560" height="560" fill="#fff"/>
    <rect x="24" y="24" width="512" height="512" fill="none" stroke="#111827" stroke-width="8"/>
    <text x="280" y="235" text-anchor="middle" font-size="28" font-family="Arial, sans-serif" fill="#111827">二维码生成失败</text>
    <text x="280" y="275" text-anchor="middle" font-size="18" font-family="Arial, sans-serif" fill="#374151">请刷新页面，或复制下方链接打开</text>
    <foreignObject x="45" y="310" width="470" height="160">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font:16px Arial,sans-serif;word-break:break-all;color:#111827;text-align:center;line-height:1.45;">${safeUrl}</div>
    </foreignObject>
  </svg>`;
}

async function adminQuestions(request, env) {
  const rows = await env.DB.prepare("SELECT * FROM questions ORDER BY enabled DESC, point_code ASC, id DESC").all();
  const options = [`<option value="ALL">通用题：所有点位可抽取</option>`, ...CHECKPOINTS.map(p => `<option value="${p}">${POINTS[p].label}</option>`)].join("");
  return htmlPage("题库管理", `
    ${adminNav("questions")}
    <form class="card" method="post" action="/admin/questions">
      <h2>新增题目</h2>
      <label>适用点位<select name="point_code">${options}</select></label>
      <label>题目<input name="title" required maxlength="300" placeholder="请输入题目"></label>
      <div class="grid2">
        <label>A<input name="option_a" required maxlength="200"></label>
        <label>B<input name="option_b" required maxlength="200"></label>
        <label>C<input name="option_c" required maxlength="200"></label>
        <label>D<input name="option_d" required maxlength="200"></label>
      </div>
      <label>正确答案<select name="correct_option"><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
      <label>解析，可选<input name="explanation" maxlength="500" placeholder="可不填"></label>
      <button class="primary" type="submit">添加题目</button>
    </form>
    <div class="card table-card"><h2>现有题库</h2><div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>点位</th><th>题目</th><th>答案</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${(rows.results || []).map(q => `<tr><td>${q.id}</td><td>${escapeHtml(q.point_code === "ALL" ? "通用" : POINTS[q.point_code]?.short || q.point_code)}</td><td>${escapeHtml(q.title)}</td><td>${escapeHtml(q.correct_option)}</td><td>${q.enabled ? "启用" : "停用"}</td><td><form method="post" action="/admin/questions/delete" onsubmit="return confirm('确定删除这道题吗？')"><input type="hidden" name="id" value="${q.id}"><button class="linkbtn" type="submit">删除</button></form></td></tr>`).join("") || `<tr><td colspan="6" class="empty">暂无题目</td></tr>`}</tbody>
    </table></div></div>
  `, 200, env);
}

async function adminQuestionCreate(request, env) {
  const f = await request.formData();
  const point = String(f.get("point_code") || "ALL");
  if (!(point === "ALL" || CHECKPOINTS.includes(point))) return htmlPage("点位错误", `<div class="card warning"><h2>点位错误</h2></div>`, 400, env);
  const title = cleanText(f.get("title"), 300);
  const a = cleanText(f.get("option_a"), 200);
  const b = cleanText(f.get("option_b"), 200);
  const c = cleanText(f.get("option_c"), 200);
  const d = cleanText(f.get("option_d"), 200);
  const correct = String(f.get("correct_option") || "A").toUpperCase();
  const explanation = cleanText(f.get("explanation"), 500);
  if (!title || !a || !b || !c || !d || !["A", "B", "C", "D"].includes(correct)) {
    return htmlPage("题目信息不完整", `<div class="card warning"><h2>题目信息不完整</h2></div>`, 400, env);
  }
  await env.DB.prepare(`
    INSERT INTO questions (point_code, title, option_a, option_b, option_c, option_d, correct_option, explanation, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(point, title, a, b, c, d, correct, explanation, nowIso()).run();
  return redirect("/admin/questions");
}

async function adminQuestionDelete(request, env) {
  const f = await request.formData();
  const id = Number(f.get("id"));
  if (!Number.isFinite(id)) return redirect("/admin/questions");
  await env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
  return redirect("/admin/questions");
}

async function adminExportCsv(request, env) {
  const rows = await env.DB.prepare(`
    SELECT p.name, p.phone, p.department, p.checkin_at, p.checkout_at, p.completed_at,
      MAX(CASE WHEN r.point_code = 'cp1' THEN r.answered_at END) AS cp1_at,
      MAX(CASE WHEN r.point_code = 'cp2' THEN r.answered_at END) AS cp2_at,
      MAX(CASE WHEN r.point_code = 'cp3' THEN r.answered_at END) AS cp3_at,
      COUNT(r.id) AS answered_count
    FROM participants p
    LEFT JOIN checkpoint_records r ON p.id = r.participant_id
    GROUP BY p.id
    ORDER BY p.checkin_at DESC
  `).all();

  const header = ["姓名", "手机号", "部门", "签到时间", "签退时间", "完成状态", "完成点位数", "完成点位", "点位一打点时间", "点位二打点时间", "点位三打点时间"];
  const lines = [header, ...(rows.results || []).map(r => {
    const finishedPoints = [];
    if (r.cp1_at) finishedPoints.push("点位一");
    if (r.cp2_at) finishedPoints.push("点位二");
    if (r.cp3_at) finishedPoints.push("点位三");
    return [
      r.name,
      r.phone || "",
      r.department,
      fmt(r.checkin_at),
      fmt(r.checkout_at),
      r.checkout_at ? "已完成" : "进行中",
      Number(r.answered_count || 0),
      finishedPoints.join("、"),
      fmt(r.cp1_at),
      fmt(r.cp2_at),
      fmt(r.cp3_at)
    ];
  })];
  const csv = "\uFEFF" + lines.map(cols => cols.map(csvCell).join(",")).join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="walk-participants-${new Date().toISOString().slice(0,10)}.csv"`
    }
  });
}

async function ensureParticipantPhoneColumn(env) {
  if (phoneColumnReady || !env.DB) return;
  try {
    const info = await env.DB.prepare("PRAGMA table_info(participants)").all();
    const columns = (info.results || []).map(c => c.name);
    if (!columns.length) return;
    if (!columns.includes("phone")) {
      await env.DB.prepare("ALTER TABLE participants ADD COLUMN phone TEXT NOT NULL DEFAULT ''").run();
    }
    phoneColumnReady = true;
  } catch (err) {
    console.warn("ensureParticipantPhoneColumn skipped", err?.message || err);
  }
}

function departmentOptions(selected = "") {
  return DEPARTMENTS.map(d => `<option value="${escapeAttr(d)}" ${d === selected ? "selected" : ""}>${escapeHtml(d)}</option>`).join("");
}

function isValidPhone(phone) {
  return /^[0-9+()\-\s]{5,20}$/.test(String(phone || ""));
}

async function getProgress(env, participantId) {
  const rows = await env.DB.prepare("SELECT point_code, answered_at, is_correct FROM checkpoint_records WHERE participant_id = ?")
    .bind(participantId).all();
  const done = new Map((rows.results || []).map(r => [r.point_code, r]));
  const remaining = CHECKPOINTS.filter(p => !done.has(p));
  return { done, remaining, doneCount: 3 - remaining.length };
}

function progressCard(progress) {
  return `<div class="card progress-card"><h2>点位完成：${progress.doneCount} / 3（任一即可签退）</h2><div class="progress-row">
    ${CHECKPOINTS.map(p => `<div class="progress-item ${progress.done.has(p) ? "done" : "todo"}"><b>${escapeHtml(POINTS[p].short)}</b><span>${progress.done.has(p) ? "已完成" : "未完成"}</span></div>`).join("")}
  </div></div>`;
}

function optionRadio(key, text) {
  return `<label class="option"><input type="radio" name="selected_option" value="${key}" required><span><b>${key}.</b> ${escapeHtml(text)}</span></label>`;
}

function statusCell(value) {
  return value ? `<span class="pill ok">已完成</span><br>${fmt(value)}` : `<span class="pill no">未完成</span>`;
}

function adminNav(active = "") {
  return `<nav class="admin-nav">
    <a class="${active === "dashboard" ? "active" : ""}" href="/admin">记录后台</a>
    <a class="${active === "qrs" ? "active" : ""}" href="/admin/qrs">动态二维码</a>
    <a class="${active === "questions" ? "active" : ""}" href="/admin/questions">题库管理</a>
    <a href="/admin/logout">退出</a>
  </nav>`;
}

function clientQrRefreshScript() {
  return `
    const intervalMs = 20000;
    const displayKey = new URLSearchParams(location.search).get('k') || '';
    function refreshQrs(){
      document.querySelectorAll('.live-qr').forEach(img => {
        const p = img.dataset.point;
        const keyPart = displayKey ? '&k=' + encodeURIComponent(displayKey) : '';
        img.src = '/api/qrcode.svg?point=' + encodeURIComponent(p) + keyPart + '&_=' + Date.now();
      });
      const cd = document.getElementById('countdown');
      if (cd) cd.textContent = '二维码已刷新：' + new Date().toLocaleTimeString();
    }
    refreshQrs();
    setInterval(refreshQrs, intervalMs);
  `;
}

async function canViewQr(request, env, point) {
  if (!POINTS[point]) return false;
  if (await isAdmin(request, env)) return true;
  const url = new URL(request.url);
  const k = url.searchParams.get("k") || "";
  const expected = pointKey(env, point);
  return !!expected && k === expected;
}

async function clearParticipantSession(request, env) {
  return htmlPage("已清除", `<div class="card success-card"><h2>已清除本机签到信息</h2><p>现在可重新扫描起点二维码进行签到。</p></div>`, 200, env, {
    "Set-Cookie": `walk_pid=; ${cookieAttrs(request)}; Max-Age=0`
  });
}

async function getParticipantFromCookie(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.walk_pid;
  if (!token) return null;
  const payload = await verifyToken(token, secret(env));
  if (!payload || payload.kind !== "participant" || !payload.pid) return null;
  return await env.DB.prepare("SELECT * FROM participants WHERE id = ?").bind(payload.pid).first();
}

async function participantCookie(pid, env, request) {
  const token = await signToken({ kind: "participant", pid, exp: unixNow() + 30 * 24 * 3600 }, secret(env));
  return `walk_pid=${token}; ${cookieAttrs(request)}; Max-Age=${30 * 24 * 3600}`;
}

async function isAdmin(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies.admin_session;
  if (!token) return false;
  const payload = await verifyToken(token, adminSecret(env));
  return !!payload && payload.kind === "admin";
}

function cookieAttrs(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function parseCookies(header) {
  const out = {};
  header.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return out;
}

function secret(env) {
  return env.QR_SECRET || DEFAULT_QR_SECRET;
}
function adminSecret(env) {
  return `${secret(env)}:${env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD}`;
}
function pointKeyEnvName(point) {
  return { start: "QR_KEY_START", cp1: "QR_KEY_CP1", cp2: "QR_KEY_CP2", cp3: "QR_KEY_CP3" }[point] || "";
}
function pointKey(env, point) {
  const name = pointKeyEnvName(point);
  return name ? String(env[name] || "") : "";
}
function pointKeyConfigured(env, point) {
  return pointKey(env, point).length > 0;
}
function qrTtl(env) {
  const n = Number(env.QR_TOKEN_TTL_SECONDS || 45);
  return Number.isFinite(n) && n >= 15 ? n : 45;
}
function actionTtl(env) {
  const n = Number(env.ACTION_TOKEN_TTL_SECONDS || 600);
  return Number.isFinite(n) && n >= 120 ? n : 600;
}
function unixNow() { return Math.floor(Date.now() / 1000); }
function nowIso() { return new Date().toISOString(); }

async function signToken(payload, key) {
  const body = base64url(JSON.stringify(payload));
  const sig = await hmac(body, key);
  return `${body}.${sig}`;
}

async function verifyToken(token, key) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = await hmac(body, key);
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
    if (payload.exp && Number(payload.exp) < unixNow()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

async function hmac(data, key) {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return base64urlBytes(new Uint8Array(sig));
}

function base64url(str) {
  return base64urlBytes(new TextEncoder().encode(str));
}
function base64urlBytes(bytes) {
  let bin = "";
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64urlDecode(s) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function htmlPage(title, body, status = 200, env = {}, headers = {}, displayMode = false) {
  const fullTitle = `${title} - ${env.EVENT_TITLE || "健步走签到打点系统"}`;
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(fullTitle)}</title><style>${styles()}</style></head><body class="${displayMode ? "display-body" : ""}"><div class="app">${body}</div></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}

function fmt(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  } catch (_) { return value; }
}

function csvCell(v) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function cleanText(v, max) {
  return String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function styles() {
  return `
    :root{--bg:#f4f7fb;--card:#fff;--text:#172033;--muted:#667085;--line:#e6eaf0;--brand:#2563eb;--ok:#10b981;--warn:#f59e0b;--danger:#ef4444;--shadow:0 10px 30px rgba(16,24,40,.08)}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#eef4ff 0%,var(--bg) 320px);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Arial,sans-serif}a{color:var(--brand);text-decoration:none}.app{width:min(1080px,100%);margin:0 auto;padding:20px}.hero{padding:28px 18px 14px}.hero h1{font-size:34px;line-height:1.15;margin:10px 0}.hero p{font-size:17px;color:var(--muted);line-height:1.65;margin:0}.badge{display:inline-block;padding:6px 12px;border-radius:999px;background:#e0ecff;color:#174ea6;font-weight:700;font-size:13px}.card{background:var(--card);border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow);padding:20px;margin:16px 0}.card h2{margin:0 0 14px;font-size:22px}.muted{color:var(--muted)}.warning{border-color:#fde68a;background:#fffbeb}.danger{border-color:#fecaca;background:#fff1f2}.success-card{border-color:#bbf7d0;background:#f0fdf4}.danger-text{color:var(--danger)}.small{font-size:13px;color:var(--muted)}label{display:block;font-weight:700;margin:14px 0 8px}input,select{width:100%;padding:13px 14px;border:1px solid #cfd8e3;border-radius:14px;font:inherit;background:#fff}button,.button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:14px;padding:12px 18px;font-weight:800;font-size:16px;cursor:pointer}.primary{background:var(--brand);color:#fff;width:100%;margin-top:16px}.success{background:var(--ok);color:#fff;width:100%;margin-top:16px}.secondary{background:#eef2f7;color:#344054;width:100%;margin-top:10px}.danger-button{background:var(--danger);color:#fff}.linkbtn{background:none;color:var(--danger);padding:4px}.table-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.table-actions form{margin:0}.confirm-row{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);padding:12px 0}.confirm-row:last-child{border-bottom:0}.confirm-row span{color:var(--muted)}.confirm-row b{text-align:right}.option{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);border-radius:16px;padding:14px;margin:12px 0;font-weight:500}.option input{width:auto;margin-top:4px}.progress-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.progress-item{border:1px solid var(--line);border-radius:16px;padding:16px;text-align:center}.progress-item b{display:block;font-size:18px}.progress-item span{color:var(--muted);font-size:14px}.progress-item.done{border-color:#86efac;background:#f0fdf4}.progress-item.todo{background:#f8fafc}.admin-nav{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 20px}.admin-nav a{padding:10px 14px;border-radius:999px;background:#fff;border:1px solid var(--line);font-weight:800}.admin-nav a.active{background:var(--brand);color:#fff;border-color:var(--brand)}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.stats div{background:#fff;border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:var(--shadow)}.stats b{font-size:34px;display:block}.stats span{color:var(--muted)}.table-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:12px;text-align:left;vertical-align:top}th{background:#f8fafc;color:#475467}.pill{display:inline-block;border-radius:999px;padding:4px 9px;font-weight:800;font-size:12px}.pill.ok{background:#dcfce7;color:#166534}.pill.no{background:#f1f5f9;color:#475569}.pill.doing{background:#fef3c7;color:#92400e}.empty{text-align:center;color:var(--muted);padding:30px}.qr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.qr-mini-card{background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow);padding:18px;text-align:center}.qr-mini-card img{width:min(320px,100%);height:auto;background:#fff}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.display-body{background:#0f172a;color:#fff}.display-body .app{width:100%;min-height:100vh;display:flex;align-items:center;justify-content:center}.display-page{text-align:center;padding:30px}.display-title{font-size:28px;font-weight:900;opacity:.85}.display-page h1{font-size:64px;margin:22px 0}.display-qr{width:min(72vh,680px);max-width:92vw;border:18px solid #fff;border-radius:28px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.35)}.display-page p{font-size:22px;opacity:.85}.success-hero{background:linear-gradient(135deg,#ecfdf5,#eff6ff);border-radius:24px;margin-top:10px}@media(max-width:720px){.app{padding:12px}.hero h1{font-size:28px}.progress-row,.stats,.qr-grid,.grid2{grid-template-columns:1fr}.display-page h1{font-size:38px}.display-title{font-size:20px}.display-page p{font-size:16px}}
  `;
}
