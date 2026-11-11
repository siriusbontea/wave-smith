/**
 * lib/phone/secret.ts — per-boot secret only the gateway and this app share.
 *
 * Written at process start and kept if this same boot is still alive, so a
 * worker can read it. A new boot replaces it. It never goes to the phone.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function secretPath(): string {
  const data = process.env.DATA_DIR && process.env.DATA_DIR !== "" ? process.env.DATA_DIR : "./data";
  return path.resolve(data, "phone-gateway-secret");
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Create or reuse this boot's secret and publish it on process.env. */
export function ensureGatewaySecret(): string {
  const fromEnv = process.env.WAVESMITH_GATEWAY_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  const file = secretPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const [pidText, secret] = fs.readFileSync(file, "utf8").split("\n");
    const pid = Number(pidText);
    if (secret && secret.length >= 32 && (pid === process.pid || pidAlive(pid))) {
      process.env.WAVESMITH_GATEWAY_SECRET = secret;
      return secret;
    }
  } catch {
    // Missing file: fall through and create one.
  }
  const secret = randomBytes(32).toString("base64url");
  fs.writeFileSync(file, `${process.pid}\n${secret}\n`, { mode: 0o600 });
  process.env.WAVESMITH_GATEWAY_SECRET = secret;
  return secret;
}

export function gatewaySecret(): string {
  return ensureGatewaySecret();
}

/** Not the secret. The gateway checks this on /api/health so it does not proxy to some other program. */
export function instanceMark(): string {
  return createHash("sha256").update(gatewaySecret()).digest("hex").slice(0, 32);
}
