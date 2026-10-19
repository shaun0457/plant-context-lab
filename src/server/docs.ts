/**
 * Locate the package root (works from src/server in tests and from dist/ when
 * bundled) and read the docs that are exposed as MCP resources.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      try {
        if (JSON.parse(readFileSync(pj, 'utf8')).name === 'plant-context-lab') return dir;
      } catch { /* keep walking */ }
    }
    dir = dirname(dir);
  }
  throw new Error('plant-context-lab package root not found');
}

export interface Docs {
  systemPrompt: string;
  operatingManual: string;
  architecture: string;
  rules: string;
}

export function loadDocs(root = packageRoot()): Docs {
  const read = (f: string) => readFileSync(join(root, 'docs', f), 'utf8');
  return {
    systemPrompt: read('system-prompt.md'),
    operatingManual: read('operating-manual.md'),
    architecture: read('architecture.md'),
    rules: read('rules.md'),
  };
}
