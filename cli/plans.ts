/**
 * cli/plans.ts — update and uninstall stay away from songs unless asked.
 * .env is never deleted. The model download is deleted only with an explicit yes.
 */

export function updateCommands(): string[][] {
  return [
    ["git", "pull", "--ff-only"],
    ["pnpm", "install"],
    ["pnpm", "db:migrate"],
    ["pnpm", "build"],
  ];
}

export interface UninstallPlan {
  remove: string[];
  keep: string[];
}

export function planUninstall(input: {
  root: string;
  home: string;
  deleteData: boolean;
  deleteWeights: boolean;
}): UninstallPlan {
  const remove = [
    `${input.home}/.local/bin/wavesmith`,
    `${input.home}/Applications/Wavesmith.app`,
    `${input.home}/Library/LaunchAgents/com.wavesmith.login.plist`,
  ];
  const keep = [`${input.root}/.env`];
  if (input.deleteData) remove.push(`${input.root}/data`);
  else keep.push(`${input.root}/data`);
  if (input.deleteWeights) remove.push(`${input.root}/engine`);
  else keep.push(`${input.root}/engine`);
  return { remove, keep };
}

export function lastLines(text: string, count: number): string {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}
