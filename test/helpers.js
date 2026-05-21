import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(import.meta.dirname, '..');

export function makeTempHome(prefix = 'zylos-zalo-test-') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(home, 'zylos/components/zalo'), { recursive: true });
  return home;
}

export function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export async function withTempHome(fn) {
  const oldHome = process.env.HOME;
  const oldToken = process.env.ZALO_BOT_TOKEN;
  const home = makeTempHome();
  process.env.HOME = home;
  delete process.env.ZALO_BOT_TOKEN;
  try {
    return await fn(home);
  } finally {
    process.env.HOME = oldHome;
    if (oldToken === undefined) delete process.env.ZALO_BOT_TOKEN;
    else process.env.ZALO_BOT_TOKEN = oldToken;
    cleanupDir(home);
  }
}

export async function freshImport(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return import(`${pathToFileURL(fullPath).href}?t=${Date.now()}-${Math.random()}`);
}

export function runNode(args, { env = {}, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      args,
      {
        cwd: repoRoot,
        env: { ...process.env, ...env }
      },
      (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          stdout,
          stderr
        });
      }
    );
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}
