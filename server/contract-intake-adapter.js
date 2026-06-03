const { execFile } = require("child_process");
const path = require("path");
const { getProviderStatus } = require("../scripts/ai-runner-lib");
const { parseRunnerJson } = require("./utils");

const PROVIDER_STATUS = getProviderStatus();
const RUNNER = process.env.CONTRACT_INTAKE_RUNNER_SCRIPT || (PROVIDER_STATUS.mode === "openai-compatible" ? "scripts/ai-intake-runner.js" : "scripts/codex-intake-runner.js");

function runContractIntake(request) {
  return new Promise((resolve, reject) => {
    const runnerPath = path.resolve(process.cwd(), RUNNER);
    const child = execFile(process.execPath, [runnerPath], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ""}`.trim()));
        return;
      }
      try {
        resolve({
          ok: true,
          source: path.basename(RUNNER),
          ...parseRunnerJson(stdout),
        });
      } catch (parseError) {
        reject(parseError);
      }
    });
    child.stdin.write(JSON.stringify(request || {}, null, 2));
    child.stdin.end();
  });
}

module.exports = { runContractIntake };
