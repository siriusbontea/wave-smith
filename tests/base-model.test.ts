import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { baseModelOnDisk } from "@/lib/engine/base-model";

describe("base model on disk", () => {
  it("requires a weight file, not an empty directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-base-"));
    expect(baseModelOnDisk(root)).toBe(false);
    const dir = path.join(root, "checkpoints", "acestep-v15-base");
    fs.mkdirSync(dir, { recursive: true });
    expect(baseModelOnDisk(root)).toBe(false);
    fs.writeFileSync(path.join(dir, "model.safetensors"), "weights");
    expect(baseModelOnDisk(root)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
