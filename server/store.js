/**
 * Storage facade — delegates to SQLite backend.
 * Keeps exact same exports as before so callers need zero changes.
 */
const sqlite = require("./store-sqlite");

module.exports = {
  readDb: sqlite.readDb,
  writeDb: sqlite.writeDb,
  replaceDb: sqlite.replaceDb,
  saveFile: sqlite.saveFile,
  flattenClauseActions: sqlite.flattenClauseActions,
  saveContractFile: sqlite.saveContractFile,
  getContractFiles: sqlite.getContractFiles,
  getFileById: sqlite.getFileById,
  deleteFile: sqlite.deleteFile,
  getContractFolder: sqlite.getContractFolder,
  listAllContractsWithPaths: sqlite.listAllContractsWithPaths,
  runAutoBackup: sqlite.runAutoBackup,
  search: sqlite.search,
  searchContracts: sqlite.searchContracts,
  searchClauses: sqlite.searchClauses,
  searchGlobal: sqlite.searchGlobal,
  DATA_DIR: sqlite.DATA_DIR,
  DB_PATH: sqlite.DB_PATH,
  FILE_DIR: sqlite.FILE_DIR,
  WORKBENCH_ROOT: sqlite.WORKBENCH_ROOT,
};
