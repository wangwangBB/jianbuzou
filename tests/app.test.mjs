import test from "node:test";
import assert from "node:assert/strict";
import { fixture, field, now, sign, answerAuthorization } from "./helpers.mjs";

test("full original registration: phone, department, confirmation, three camera cards", async () => {
  const f = fixture();
  const entry = await f.call("/scan?token=" + f.qr("start"));
  const html = await entry.text();
  assert.match(html, /name="phone"/);
  assert.match(html, /<select name="department"/);
  const form = { action_token: field(html, "action_token"), name: "张三", phone: "13800138001", department: "公司领导" };
  const confirmation = await f.call("/checkin", { form });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM participants").get().n, 0);
  const confirmToken = field(await confirmation.text(), "confirm_token");
  const signedIn = await f.call("/checkin/confirm", { form: { confirm_token: confirmToken } });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get("Set-Cookie").split(";")[0];
  assert.match(signedIn.headers.get("Set-Cookie"), /HttpOnly; SameSite=Lax; Secure/);
  const page = await signedIn.text();
  for (const cp of ["cp1", "cp2", "cp3"]) assert.match(page, new RegExp(`data-scan-point="${cp}"`));
  assert.match(page, /13800138001/);
  assert.equal(f.records(), 0);
  assert.equal((await f.call("/me", { cookie })).status, 200);
  await f.call("/checkin/confirm", { form: { confirm_token: confirmToken } });
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM participants").get().n, 1);
});

test("no-cookie home, checkpoint scan and answer cannot create records", async () => {
  const f = fixture(), p = f.participant();
  assert.equal((await f.call("/me")).status, 401);
  const scan = await f.call("/scan/verify", { form: { expected_point: "cp1", token: f.qr("cp1") } });
  assert.match(await scan.text(), /请先到起点签到/);
  const answer = await f.call("/answer", { form: { answer_token: await answerAuthorization(f, p), selected_option: "A" } });
  assert.equal(answer.status, 403);
  assert.equal(f.records(), 0);
});

for (const selected of ["cp1", "cp2", "cp3"]) {
  for (const actual of ["cp1", "cp2", "cp3", "start"]) {
    test(`selected ${selected}, QR ${actual}: exact point match required`, async () => {
      const f = fixture(), p = f.participant();
      const response = await f.call("/scan/verify", { cookie: p.cookie, form: { expected_point: selected, token: f.qr(actual) } });
      const html = await response.text();
      assert.equal(response.status, selected === actual ? 200 : 400);
      if (selected === actual) assert.match(html, /name="answer_token"/);
      else { assert.match(html, /点位不匹配/); assert.doesNotMatch(html, /name="answer_token"/); }
      assert.equal(f.records(), 0);
    });
  }
}

test("reject expired-at-boundary, future, overlong, wrong-kind, unsigned and altered codes", async () => {
  const f = fixture(), p = f.participant();
  const valid = f.qr("cp1");
  const [body, signature] = valid.split(".");
  const changed = JSON.parse(Buffer.from(body, "base64url").toString());
  changed.point = "cp2";
  const tokens = [
    "", "cp1", "x".repeat(5000), valid + ".extra",
    f.qr("cp1", { exp: now() }), f.qr("cp1", { exp: now() - 1 }),
    f.qr("cp1", { iat: now() + 20 }), f.qr("cp1", { exp: now() + 121 }),
    f.qr("cp1", { exp: "9999999999" }), f.qr("cp1", { exp: null }),
    f.qr("cp1", { kind: "participant" }), f.qr("cp1", { v: 1 }),
    f.qr("constructor"), f.qr("__proto__"),
    Buffer.from(JSON.stringify(changed)).toString("base64url") + "." + signature,
    sign({ kind: "qr", point: "cp1", v: 2, iat: now(), exp: now() + 45, nonce: "long-random-nonce" }, "wrong-key")
  ];
  for (const token of tokens) {
    const response = await f.call("/scan/verify", { cookie: p.cookie, form: { expected_point: "cp1", token } });
    assert.equal(response.status, 400, token);
    assert.doesNotMatch(await response.text(), /name="answer_token"/);
  }
  assert.equal(f.records(), 0);
});

test("plain point URLs, absent token and wrong start code do not authorize completion", async () => {
  const f = fixture(), p = f.participant();
  for (const path of ["/scan?point=cp1", "/scan", "/checkpoint/cp1", "/scan/verify?point=cp1"]) {
    assert.ok((await f.call(path, { cookie: p.cookie })).status >= 400);
  }
  const wrong = await f.call("/scan/verify", { cookie: p.cookie, form: { expected_point: "start", token: f.qr("cp1") } });
  assert.equal(wrong.status, 400);
  assert.equal(f.records(), 0);
});

test("scanning alone does not record; valid answer records; duplicate cannot change answer", async () => {
  const f = fixture(), p = f.participant();
  const token = await answerAuthorization(f, p);
  assert.equal(f.records(), 0);
  const first = await f.call("/answer", { cookie: p.cookie, form: { answer_token: token, selected_option: "B" } });
  assert.equal(first.status, 200);
  assert.equal(f.records(), 1);
  await f.call("/answer", { cookie: p.cookie, form: { answer_token: token, selected_option: "A" } });
  assert.equal(f.records(), 1);
  assert.equal(f.sqlite.prepare("SELECT selected_option FROM checkpoint_records").get().selected_option, "B");
  const completed = await f.call("/scan?token=" + f.qr("cp1"), { cookie: p.cookie });
  assert.doesNotMatch(await completed.text(), /name="answer_token"/);
  assert.match(await (await f.call("/me", { cookie: p.cookie })).text(), /data-scan-point="cp1" disabled/);
});

test("simultaneous submissions insert exactly one row with no server errors", async () => {
  const f = fixture(), p = f.participant();
  const token = await answerAuthorization(f, p);
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => f.call("/answer", {
    cookie: p.cookie, form: { answer_token: token, selected_option: i % 2 ? "A" : "B" }
  })));
  assert.equal(f.records(), 1);
  assert.ok(responses.every(r => r.status === 200 || r.status === 409));
});

test("answer authorization is tied to participant, point and original question", async () => {
  const f = fixture(), p = f.participant(), other = f.participant();
  const token = await answerAuthorization(f, p);
  assert.equal((await f.call("/answer", { cookie: other.cookie, form: { answer_token: token, selected_option: "A" } })).status, 403);
  const [body, sig] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  payload.point = "cp3";
  assert.equal((await f.call("/answer", { cookie: p.cookie, form: { answer_token: Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + sig, selected_option: "A" } })).status, 400);
  assert.equal(f.records(), 0);
});

test("answer time is independent of QR lifetime but expires at its own deadline", async () => {
  const f = fixture(), p = f.participant();
  const token = await answerAuthorization(f, p);
  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
  assert.ok(payload.exp - now() >= 599);
  const expired = sign({ ...payload, exp: now() }, f.env.QR_SECRET);
  assert.equal((await f.call("/answer", { cookie: p.cookie, form: { answer_token: expired, selected_option: "A" } })).status, 400);
  assert.equal(f.records(), 0);
});

test("disabled or moved question and invalid answer reject without recording", async () => {
  const f = fixture(), p = f.participant();
  const token = await answerAuthorization(f, p);
  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
  assert.equal((await f.call("/answer", { cookie: p.cookie, form: { answer_token: token, selected_option: "E" } })).status, 400);
  f.sqlite.prepare("UPDATE questions SET point_code='cp3' WHERE id=?").run(payload.qid);
  assert.equal((await f.call("/answer", { cookie: p.cookie, form: { answer_token: token, selected_option: "A" } })).status, 400);
  f.sqlite.prepare("UPDATE questions SET point_code='ALL', enabled=0 WHERE id=?").run(payload.qid);
  assert.equal((await f.call("/answer", { cookie: p.cookie, form: { answer_token: token, selected_option: "A" } })).status, 400);
  assert.equal(f.records(), 0);
});

test("checkout before insert prevents a racing answer from recording", async () => {
  const f = fixture(), p = f.participant();
  const token = await answerAuthorization(f, p);
  f.db.beforeRun = async sql => {
    if (sql.includes("INSERT INTO checkpoint_records")) {
      f.sqlite.prepare("UPDATE participants SET checkout_at=? WHERE id=?").run(new Date().toISOString(), p.id);
    }
  };
  const response = await f.call("/answer", { cookie: p.cookie, form: { answer_token: token, selected_option: "A" } });
  assert.equal(response.status, 409);
  assert.equal(f.records(), 0);
});

test("participant deleted just before insert cannot acquire an orphan record", async () => {
  const f = fixture(), p = f.participant();
  const token = await answerAuthorization(f, p);
  f.db.beforeRun = async sql => {
    if (sql.includes("INSERT INTO checkpoint_records")) f.sqlite.prepare("DELETE FROM participants WHERE id=?").run(p.id);
  };
  assert.equal((await f.call("/answer", { cookie: p.cookie, form: { answer_token: token, selected_option: "A" } })).status, 409);
  assert.equal(f.records(), 0);
});

test("any single point permits checkout only after scanning a fresh start QR", async () => {
  for (const point of ["cp1", "cp2", "cp3"]) {
    const f = fixture(), p = f.participant();
    assert.doesNotMatch(await (await f.call("/scan?token=" + f.qr("start"), { cookie: p.cookie })).text(), /name="action_token"/);
    assert.equal((await f.call("/checkout", { cookie: p.cookie, form: { action_token: f.qr("start") } })).status, 400);
    const answer_token = await answerAuthorization(f, p, point);
    await f.call("/answer", { cookie: p.cookie, form: { answer_token, selected_option: "A" } });
    const home = await (await f.call("/me", { cookie: p.cookie })).text();
    assert.doesNotMatch(home, /name="action_token"/);
    assert.match(home, /data-scan-point="start"/);
    const entry = await f.call("/scan/verify", { cookie: p.cookie, form: { expected_point: "start", token: f.qr("start") } });
    const action_token = field(await entry.text(), "action_token");
    const result = await f.call("/checkout", { cookie: p.cookie, form: { action_token } });
    assert.match(await result.text(), /已完成比赛/);
    const time = f.sqlite.prepare("SELECT checkout_at FROM participants WHERE id=?").get(p.id).checkout_at;
    await f.call("/checkout", { cookie: p.cookie, form: { action_token } });
    assert.equal(f.sqlite.prepare("SELECT checkout_at FROM participants WHERE id=?").get(p.id).checkout_at, time);
    assert.doesNotMatch(await (await f.call("/scan?token=" + f.qr("cp2"), { cookie: p.cookie })).text(), /name="answer_token"/);
    assert.equal(f.records(), 1);
  }
});

test("export remains one row per participant including phone and all point times", async () => {
  const f = fixture(), p = f.participant();
  for (const point of ["cp1", "cp2", "cp3"]) {
    await f.call("/answer", { cookie: p.cookie, form: { answer_token: await answerAuthorization(f, p, point), selected_option: "A" } });
  }
  const exported = await f.call("/admin/export.csv", { cookie: f.adminCookie });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("Cache-Control"), /no-store/);
  const csv = await exported.text();
  assert.equal(csv.trim().split("\n").length, 2);
  assert.match(csv, /13800138000/);
  assert.match(csv, /点位一、点位二、点位三/);
});

test("admin deletion and clearing preserve question bank and remove point records", async () => {
  const f = fixture(), p = f.participant(), other = f.participant();
  const questionCount = f.sqlite.prepare("SELECT COUNT(*) AS n FROM questions").get().n;
  for (const person of [p, other]) await f.call("/answer", { cookie: person.cookie, form: { answer_token: await answerAuthorization(f, person), selected_option: "A" } });
  const unauth = await f.call("/admin/participants/delete", { form: { id: p.id } });
  assert.equal(unauth.status, 302);
  assert.equal(f.records(), 2);
  await f.call("/admin/participants/delete", { cookie: f.adminCookie, form: { id: p.id } });
  assert.equal(f.records(), 1);
  assert.equal((await f.call("/me", { cookie: p.cookie })).status, 401);
  await f.call("/admin/participants/clear", { cookie: f.adminCookie, form: {} });
  assert.equal(f.records(), 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM participants").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM questions").get().n, questionCount);
});

test("participants cannot generate QR codes or open staff displays", async () => {
  const f = fixture(), p = f.participant();
  assert.equal((await f.call("/api/qrcode.svg?point=cp1", { cookie: p.cookie })).status, 401);
  assert.equal((await f.call("/display/cp1", { cookie: p.cookie })).status, 302);
  const display = await f.call("/display/cp1", { cookie: f.adminCookie });
  assert.equal(display.status, 200);
  assert.match(await display.text(), /data-point="cp1"/);
  assert.equal((await f.call("/api/qrcode.svg?point=constructor", { cookie: f.adminCookie })).status, 400);
});

test("same-origin POST guard and secure deployment configuration fail closed", async () => {
  const f = fixture();
  assert.equal((await f.call("/admin/participants/clear", { cookie: f.adminCookie, form: {}, headers: { Origin: "https://other.example" } })).status, 403);
  f.env.QR_SECRET = "dev-secret-change-me";
  assert.equal((await f.call("/admin/login")).status, 503);
});

test("question management and original login still work", async () => {
  const f = fixture();
  const login = await f.call("/admin/login", { form: { password: f.env.ADMIN_PASSWORD } });
  assert.equal(login.status, 302);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  const create = await f.call("/admin/questions", { cookie, form: { point_code: "cp2", title: "独立点位测试题", option_a: "甲", option_b: "乙", option_c: "丙", option_d: "丁", correct_option: "B", explanation: "测试" } });
  assert.equal(create.status, 302);
  const question = f.sqlite.prepare("SELECT * FROM questions WHERE title=?").get("独立点位测试题");
  assert.equal(question.point_code, "cp2");
  await f.call("/admin/questions/delete", { cookie, form: { id: question.id } });
  assert.equal(f.sqlite.prepare("SELECT * FROM questions WHERE id=?").get(question.id), undefined);
});
