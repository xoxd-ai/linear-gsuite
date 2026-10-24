import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { persistOAuthLoginConfig } from "../src/google.js";

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
