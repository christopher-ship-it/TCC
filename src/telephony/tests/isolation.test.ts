import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_BARE = new Set(['react']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

test('the telephony module imports nothing from outside itself (so it can be lifted into another project)', () => {
  const offenders: string[] = [];
  for (const file of files(root)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (relative(root, target).startsWith('..')) offenders.push(`${relative(root, file)} → ${spec}`);
      } else if (!ALLOWED_BARE.has(spec)) {
        offenders.push(`${relative(root, file)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
