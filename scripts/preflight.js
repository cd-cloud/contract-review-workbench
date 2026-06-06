const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  DEFAULT_PORT,
  appRoot,
  canListen,
  defaultPortableDataDir,
  ensureWritableDirectory,
  findAvailablePort,
} = require("./portable-runtime");

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    label: "Node.js version",
    ok: major >= 20 && major < 23,
    detail: `current ${process.version}, expected >=20 <23`,
    fix: "Install Node.js 22 LTS, then rerun npm install.",
  };
}

function checkNpm() {
  if (process.platform === "win32") {
    const npmBesideNode = path.join(path.dirname(process.execPath), "npm.cmd");
    if (fs.existsSync(npmBesideNode)) {
      return {
        label: "npm available",
        ok: true,
        detail: npmBesideNode,
      };
    }
    const npmExecPath = process.env.npm_execpath || "";
    return {
      label: "npm available",
      ok: Boolean(npmExecPath && fs.existsSync(npmExecPath)),
      detail: npmExecPath || "npm.cmd not found next to node.exe",
      fix: "Reinstall Node.js 22 LTS. Use npm.cmd if PowerShell blocks npm.ps1.",
    };
  }
  const command = "npm";
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return {
    label: "npm available",
    ok: result.status === 0,
    detail: result.status === 0 ? `${command} ${String(result.stdout).trim()}` : String(result.stderr || result.error?.message || "npm not found").trim(),
    fix: process.platform === "win32" ? "Use npm.cmd if PowerShell blocks npm.ps1." : "Install npm with Node.js.",
  };
}

function checkDependency(name) {
  try {
    require.resolve(name, { paths: [appRoot()] });
    return { label: `dependency ${name}`, ok: true, detail: "installed" };
  } catch {
    return {
      label: `dependency ${name}`,
      ok: false,
      detail: "missing or incomplete",
      fix: "Run npm install. If Node version changed, run npm rebuild better-sqlite3.",
    };
  }
}

function checkWritableDataDir() {
  const dir = process.env.LEGAL_WORKBENCH_DATA_DIR || defaultPortableDataDir();
  try {
    ensureWritableDirectory(dir);
    return { label: "data directory writable", ok: true, detail: dir };
  } catch (error) {
    return {
      label: "data directory writable",
      ok: false,
      detail: `${dir}: ${error.message || String(error)}`,
      fix: "Set LEGAL_WORKBENCH_DATA_DIR to a writable folder.",
    };
  }
}

async function checkPort() {
  const requested = Number(process.env.LEGAL_WORKBENCH_PORT || DEFAULT_PORT);
  const available = await canListen(requested);
  if (available) return { label: "port available", ok: true, detail: String(requested) };
  try {
    const fallback = await findAvailablePort(requested + 1);
    return {
      label: "port available",
      ok: true,
      detail: `${requested} is occupied; launcher will use ${fallback} if LEGAL_WORKBENCH_PORT is unset`,
    };
  } catch (error) {
    return {
      label: "port available",
      ok: false,
      detail: error.message || String(error),
      fix: "Stop the old local workbench instance or set LEGAL_WORKBENCH_PORT to a free port.",
    };
  }
}

function findCodexCommand() {
  const configured = process.env.CODEX_CLI_COMMAND || process.env.CODEX_COMMAND;
  if (configured) return { command: configured, exists: configured === "codex" || fs.existsSync(configured) };
  const localAppData = process.env.LOCALAPPDATA || "";
  const desktopCodex = localAppData ? path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe") : "";
  if (desktopCodex && fs.existsSync(desktopCodex)) return { command: desktopCodex, exists: true };
  const lookup = spawnSync(process.platform === "win32" ? "where" : "which", ["codex"], { encoding: "utf8" });
  if (lookup.status === 0) return { command: lookup.stdout.split(/\r?\n/).filter(Boolean)[0], exists: true };
  return { command: "codex", exists: false };
}

function checkCodexSkill() {
  const provider = (process.env.LEGAL_AI_PROVIDER || process.env.AI_PROVIDER || "codex-cli").toLowerCase();
  if (provider !== "codex-cli" && provider !== "codex") {
    return { label: "Codex CLI and legal skill", ok: true, detail: `skipped for provider ${provider}` };
  }
  const codex = findCodexCommand();
  const skillPath =
    process.env.LEGAL_WORK_ORCHESTRATOR_SKILL ||
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".codex", "skills", "legal-work-orchestrator", "SKILL.md");
  const skillExists = fs.existsSync(skillPath);
  return {
    label: "Codex CLI and legal skill",
    ok: codex.exists && skillExists,
    detail: `codex=${codex.command} (${codex.exists ? "found" : "missing"}), skill=${skillPath} (${skillExists ? "found" : "missing"})`,
    fix: "Install Codex CLI and the legal-work-orchestrator skill, or configure an OpenAI-compatible provider.",
  };
}

function printCheck(check) {
  const mark = check.ok ? "OK" : "FAIL";
  console.log(`${mark} ${check.label}: ${check.detail}`);
  if (!check.ok && check.fix) console.log(`   fix: ${check.fix}`);
}

async function main() {
  const checks = [
    checkNodeVersion(),
    checkNpm(),
    checkDependency("better-sqlite3"),
    checkDependency("playwright"),
    checkDependency("electron"),
    checkWritableDataDir(),
    await checkPort(),
    checkCodexSkill(),
  ];
  checks.forEach(printCheck);
  if (!checks.every((item) => item.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
