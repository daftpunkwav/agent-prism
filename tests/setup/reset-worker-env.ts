/**
 * @file per-file worker env reset
 * @description Drops the data-dir isolation anchor before every test file.
 *
 * Vitest reuses worker processes across test files and `process.env` survives
 * the per-file module-registry reset, so a suite that anchors ARENA_DATA_DIR to
 * a scratch data dir could otherwise leak the anchor into an unrelated file
 * running later in the same worker. Deleting it here guarantees every file
 * starts unanchored; anchored suites set their own value afterwards.
 */
delete process.env.ARENA_DATA_DIR;
