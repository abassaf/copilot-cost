import { Command } from "commander";
import process from "node:process";
import { refreshPricing } from "./pricing/fetcher.js";
import { renderPayload } from "./render.js";
import { cmdInstall, cmdUninstall, cmdDoctor } from "./install.js";
import { cmdDashboard } from "./dashboard/server.js";
import { formatReport, runImport } from "./import/index.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function refreshStalePricing(): Promise<void> {
  if (process.env.COPILOT_COST_PRICING || process.env.COPILOT_COST_AUTO_REFRESH === "0") return;
  await refreshPricing();
}

async function renderCommand(): Promise<void> {
  try {
    const payload = JSON.parse(await readStdin()) as unknown;
    await refreshStalePricing();
    console.log(renderPayload(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`💰 ⚠ bad payload: ${message}`);
  }
}

function exitWith(code: number): void {
  if (code !== 0) process.exitCode = code;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const program = new Command();
  program.name("copilot-cost").exitOverride();
  program.command("render", { isDefault: true }).action(renderCommand);
  program
    .command("refresh-pricing")
    .option("--force", "refresh even if cache is fresh")
    .action(async (opts: { force?: boolean }) => {
      const pricingPath = await refreshPricing({ force: Boolean(opts.force) });
      console.log(`pricing ready: ${pricingPath}`);
    });
  program
    .command("install")
    .option("--yes", "accepted for compatibility; install does not prompt")
    .option("--no-otel-profile", "skip editing your shell profile and print manual OTel setup")
    .action(async (opts: { yes?: boolean; otelProfile?: boolean }) => exitWith(await cmdInstall({ yes: Boolean(opts.yes), otelProfile: opts.otelProfile })));
  program
    .command("uninstall")
    .option("--yes", "accept prompts")
    .action(async (opts: { yes?: boolean }) => exitWith(await cmdUninstall({ yes: Boolean(opts.yes) })));
  program.command("doctor").action(async () => exitWith(await cmdDoctor()));
  program
    .command("import-history")
    .description("import Copilot sessions that predate the OTel exporter from ~/.copilot/session-state")
    .option("--write", "write the import (default is a dry run)")
    .option("--until <iso>", "only import sessions started before this timestamp")
    .option("--allow-overlap", "skip the OTel cutover guard (may double count)")
    .option("--min-completeness <ratio>", "reconciliation floor, 0-1", (value) => Number.parseFloat(String(value)))
    .option("--json", "print the raw report as JSON")
    .action(async (opts: { write?: boolean; until?: string; allowOverlap?: boolean; minCompleteness?: number; json?: boolean }) => {
      let until: Date | null = null;
      if (opts.until) {
        const parsed = new Date(opts.until);
        if (Number.isNaN(parsed.getTime())) {
          console.error(`import-history: could not parse --until value ${opts.until}`);
          exitWith(1);
          return;
        }
        until = parsed;
      }
      const report = await runImport({
        until,
        allowOverlap: Boolean(opts.allowOverlap),
        minCompleteness: opts.minCompleteness,
        write: Boolean(opts.write),
      });
      console.log(opts.json ? JSON.stringify(report, null, 2) : formatReport(report));
    });
  program
    .command("dashboard")
    .option("--port <number>", "port to listen on", (value) => Number.parseInt(String(value), 10))
    .option("--host <host>", "host to listen on")
    .option("--no-open", "do not open the dashboard in a browser")
    .action(async (opts: { port?: number; host?: string; open?: boolean }) => {
      await refreshStalePricing();
      await cmdDashboard({ port: opts.port, host: opts.host, noOpen: opts.open === false });
    });
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error) {
      const commanderError = error as { code?: string; exitCode?: number; message?: string };
      const code = commanderError.code ?? "";
      if (code === "commander.helpDisplayed" || code === "commander.help" || code === "commander.version") {
        return;
      }
      if (code.startsWith("commander.")) {
        exitWith(commanderError.exitCode ?? 1);
        return;
      }
    }
    throw error;
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`copilot-cost: ${message}`);
  process.exitCode = 1;
});
