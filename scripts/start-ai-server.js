const {
  configureRunnerProfile,
  ensurePortableDataDir,
  ensurePortablePort,
  parseProfileArg,
  readRuntimePreference,
} = require("./portable-runtime");

async function main() {
  const dataDir = ensurePortableDataDir();
  const explicitProfile = parseProfileArg(process.argv.slice(2), "");
  const preferredProfile = explicitProfile || readRuntimePreference(dataDir).profile;
  const profile = configureRunnerProfile(preferredProfile);
  const port = await ensurePortablePort();

  console.log(`[portable] profile=${profile}`);
  console.log(`[portable] data=${dataDir}`);
  console.log(`[portable] url=http://127.0.0.1:${port}/`);
  if (process.env.LEGAL_WORKBENCH_RUNTIME_MODE) {
    console.log(`[portable] runtime_mode=${process.env.LEGAL_WORKBENCH_RUNTIME_MODE}`);
  }
  if (process.env.LEGAL_WORKBENCH_EFFECTIVE_PROVIDER) {
    console.log(`[portable] provider=${process.env.LEGAL_WORKBENCH_EFFECTIVE_PROVIDER}`);
  }
  if (process.env.LEGAL_WORKBENCH_RUNTIME_REASON) {
    console.log(`[portable] reason=${process.env.LEGAL_WORKBENCH_RUNTIME_REASON}`);
  }

  require("../server/server");
}

main().catch((error) => {
  console.error(`[portable] ${error.message || String(error)}`);
  process.exit(1);
});
