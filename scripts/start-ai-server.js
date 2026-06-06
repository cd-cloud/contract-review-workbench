const {
  configureRunnerProfile,
  ensurePortableDataDir,
  ensurePortablePort,
  parseProfileArg,
} = require("./portable-runtime");

async function main() {
  const profile = configureRunnerProfile(parseProfileArg());
  const dataDir = ensurePortableDataDir();
  const port = await ensurePortablePort();

  console.log(`[portable] profile=${profile}`);
  console.log(`[portable] data=${dataDir}`);
  console.log(`[portable] url=http://127.0.0.1:${port}/`);

  require("../server/server");
}

main().catch((error) => {
  console.error(`[portable] ${error.message || String(error)}`);
  process.exit(1);
});
