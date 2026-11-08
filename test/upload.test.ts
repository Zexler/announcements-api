import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, access, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response, NextFunction } from "express";
import { test, vi } from "vitest";

const pending = vi.hoisted(() => ({
  complete: undefined as undefined | (() => void),
}));
vi.mock("multer", () => ({
  default: () => ({
    single: () => (_req: unknown, _res: unknown, callback: () => void) => {
      pending.complete = callback;
    },
  }),
}));
const { receiveImage } = await import("../src/middleware/upload.ts");

test("закриття відповіді до завершення multer не залишає файл", async () => {
  const directory = await mkdtemp(join(tmpdir(), "announcement-upload-"));
  const path = join(directory, "photo");
  const response = Object.assign(new EventEmitter(), { destroyed: false });
  const next = vi.fn();
  try {
    await writeFile(path, "image");
    const request = { file: { path } } as Request;
    receiveImage(
      request,
      response as unknown as Response,
      next as NextFunction,
    );
    response.destroyed = true;
    response.emit("close");
    pending.complete!();
    await vi.waitFor(async () =>
      assert.rejects(access(path), { code: "ENOENT" }),
    );
    assert.equal(next.mock.calls.length, 0);
  } finally {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(directory);
  }
});
