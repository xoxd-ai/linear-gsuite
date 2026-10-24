import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { persistOAuthLoginConfig, writePrivateOAuthToken, authLogin } from "../src/google.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function temp() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "lgs-auth-")); roots.push(root); return root; }

it("preserves a managed config symlink and its target after token save", async () => {
 const root = temp(); const target = path.join(root, "managed.json"); const file = path.join(root, "config.json");
 fs.writeFileSync(target, '{"calendarId":"primary"}'); fs.symlinkSync(target, file);
 const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
 expect(await Effect.runPromise(persistOAuthLoginConfig({ authMode: "user" }, file))).toBe(false);
 expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
 expect(fs.readFileSync(target, "utf8")).toBe('{"calendarId":"primary"}');
 expect(warn).toHaveBeenCalledOnce();
});

it("merges writable local configuration", async () => {
 const file = path.join(temp(), "config.json"); fs.writeFileSync(file, '{"calendarId":"primary"}');
 expect(await Effect.runPromise(persistOAuthLoginConfig({ authMode: "user" }, file))).toBe(true);
 expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ calendarId: "primary", authMode: "user" });
});

it("retains saved authentication when a normal config cannot be written", async () => {
 const file = path.join(temp(), "config.json"); fs.writeFileSync(file, '{}');
 const original = fs.writeFileSync;
 vi.spyOn(fs, "writeFileSync").mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
  if (args[0] === file) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
  return original(...args);
 }) as typeof fs.writeFileSync);
 vi.spyOn(console, "warn").mockImplementation(() => {});
 expect(await Effect.runPromise(persistOAuthLoginConfig({ authMode: "user" }, file))).toBe(false);
 expect(fs.readFileSync(file, "utf8")).toBe('{}');
});


it.each([0o600, 0o644])("replaces an existing mode %s token with strict private permissions", async mode => {
 const file = path.join(temp(), "token.json"); fs.writeFileSync(file, '{"old":true}', { mode }); fs.chmodSync(file, mode);
 await Effect.runPromise(writePrivateOAuthToken(file, { synthetic: "test-only" }));
 expect(fs.statSync(file).mode & 0o777).toBe(0o600);
 expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ synthetic: "test-only" });
});

it("fails before writing credentials when private permissions cannot be established", async () => {
 const root = temp(); const file = path.join(root, "token.json"); fs.writeFileSync(file, "original", { mode: 0o644 });
 vi.spyOn(fs, "fchmodSync").mockImplementation(() => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); });
 const write = vi.spyOn(fs, "writeFileSync");
 await expect(Effect.runPromise(writePrivateOAuthToken(file, { synthetic: "never-written" }))).rejects.toThrow();
 expect(write).not.toHaveBeenCalled();
 expect(fs.readFileSync(file, "utf8")).toBe("original");
 expect(fs.readdirSync(root)).toEqual(["token.json"]);
});


it("does not report login success when the real Calendar probe rejects the saved token", async () => {
 const root = temp(); const client = path.join(root, "client.json"); const token = path.join(root, "token.json"); const config = path.join(root, "config.json");
 fs.writeFileSync(client, JSON.stringify({ installed: { client_id: "synthetic-client", redirect_uris: ["http://127.0.0.1"] } }));
 fs.writeFileSync(config, JSON.stringify({ oauthClientManagedFile: client }));
 const fetchMock = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).origin === "https://oauth2.googleapis.com" ? { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 } : { error: "synthetic-probe-rejection" }), { status: new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).origin === "https://oauth2.googleapis.com" ? 200 : 403, headers: { "content-type": "application/json" } }));
 vi.stubGlobal("fetch", fetchMock);
 const log = vi.spyOn(console, "log").mockImplementation((message: unknown) => {
  const text = String(message); const start = text.indexOf("https://accounts.google.com/");
  if (start < 0) return;
  const url = new URL(text.slice(start)); const callback = new URL(url.searchParams.get("redirect_uri")!);
  callback.searchParams.set("state", url.searchParams.get("state")!); callback.searchParams.set("code", "synthetic-code");
  setImmediate(() => http.get(callback, response => response.resume()));
 });
 try {
  await expect(Effect.runPromise(authLogin({ clientSecretsFile: client, tokenFile: token, localConfigFile: config, openBrowser: false }))).rejects.toThrow(/Calendar API probe failed/);
  expect(fs.statSync(token).mode & 0o777).toBe(0o600);
  expect(log.mock.calls.some(call => String(call[0]).includes("token and API access verified"))).toBe(false);
 } finally { vi.unstubAllGlobals(); }
});
