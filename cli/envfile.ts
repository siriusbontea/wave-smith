/**
 * cli/envfile.ts — read .env for child processes.
 * Values stay in memory. They are not written into the LaunchAgent.
 */

export function loadEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Child processes see .env. HOSTNAME is forced to loopback. Callers must not print this. */
export function childEnv(
  fileText: string | null,
  base: Record<string, string | undefined>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) merged[key] = value;
  }
  if (fileText) {
    // A variable already in the environment wins, same as a normal dotenv load.
    for (const [key, value] of Object.entries(loadEnvFile(fileText))) {
      if (merged[key] === undefined) merged[key] = value;
    }
  }
  merged.HOSTNAME = "127.0.0.1";
  return merged;
}
