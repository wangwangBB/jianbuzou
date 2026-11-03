import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { handleRequest } from "../functions/_app.js";

export const origin = "https://walk.example.test";
export const now = () => Math.floor(Date.now() / 1000);
export function sign(payload, key) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + createHmac("sha256", key).update(body).digest("base64url");
}
export function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../seed.sql", import.meta.url), "utf8"));
  const db = {
    beforeRun: null,
    prepare(sql) {
      const statement = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() { return sqlite.prepare(sql).get(...this.args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.args), success: true }; },
        async run() {
          if (db.beforeRun) await db.beforeRun(sql, this.args);
          const r = sqlite.prepare(sql).run(...this.args);
          return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        }
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    }
  };
  const env = { DB: db, QR_SECRET: "test-only-random-secret-32-characters-ABCDEF1234", ADMIN_PASSWORD: "test-private-admin" };
  const adminCookie = "admin_session=" + sign({ kind: "admin", exp: now() + 1000 }, env.QR_SECRET + ":" + env.ADMIN_PASSWORD);
  const call = async (path, { form, cookie, headers = {} } = {}) => handleRequest(new Request(origin + path, {
    method: form ? "POST" : "GET",
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(form ? { Origin: origin } : {}), ...headers },
    body: form ? new URLSearchParams(form) : undefined
  }), env);
  const qr = (point, extra = {}) => sign({ kind: "qr", v: 2, point, iat: now(), exp: now() + 45, nonce: randomUUID(), ...extra }, env.QR_SECRET);
  const participant = (id = randomUUID()) => {
    sqlite.prepare("INSERT INTO participants(id,name,phone,department,checkin_at,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, "测试选手", "13800138000", "公司领导", new Date().toISOString(), new Date().toISOString());
    return { id, cookie: "walk_pid=" + sign({ kind: "participant", pid: id, exp: now() + 1000 }, env.QR_SECRET) };
  };
  const records = () => Number(sqlite.prepare("SELECT COUNT(*) AS n FROM checkpoint_records").get().n);
  return { sqlite, env, db, call, qr, participant, records, adminCookie };
}
export function field(html, name) {
  const value = html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
  if (!value) throw new Error("Missing field: " + name);
  return value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
}
export async function answerAuthorization(f, p, point = "cp1") {
  const response = await f.call("/scan/verify", { cookie: p.cookie, form: { expected_point: point, token: f.qr(point) } });
  return field(await response.text(), "answer_token");
}
