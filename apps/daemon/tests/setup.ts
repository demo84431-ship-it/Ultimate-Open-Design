import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TEST_DATA_DIR_SYMBOL = Symbol.for('open-design.daemon.vitestDataDir');

const globalState = globalThis as typeof globalThis & {
  [TEST_DATA_DIR_SYMBOL]?: string;
};

if (!globalState[TEST_DATA_DIR_SYMBOL]) {
  globalState[TEST_DATA_DIR_SYMBOL] = mkdtempSync(path.join(tmpdir(), 'od-daemon-vitest-'));

  process.once('exit', () => {
    rmSync(globalState[TEST_DATA_DIR_SYMBOL]!, { force: true, recursive: true });
  });
}

// Force every daemon test process to use one isolated data directory
process.env.OD_DATA_DIR = globalState[TEST_DATA_DIR_SYMBOL];
