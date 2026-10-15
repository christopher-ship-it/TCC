import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisPrompt } from '../../src/lib/analysis/model.ts';
import { brandKey } from '../../src/brand/profiles.ts';
import { readServerEnv } from '../env.ts';

test('VITE_BRAND picks the white label; anything else is Tecstellar', () => {
  assert.equal(brandKey('vanmoh'), 'vanmoh');
  assert.equal(brandKey(' Vanmoh '), 'vanmoh');
  assert.equal(brandKey(undefined), 'tecstellar');
  assert.equal(brandKey('acme'), 'tecstellar');
  assert.equal(readServerEnv({ VITE_BRAND: 'vanmoh' }, '/tmp').brand, 'vanmoh');
  assert.equal(readServerEnv({}, '/tmp').brand, 'tecstellar');
});

test('the analysis prompt describes the brand’s business and keeps the same outcome contract', () => {
  const tec = analysisPrompt({ customer: 'A' });
  const vm = analysisPrompt({ customer: 'A' }, 'vanmoh');
  assert.match(tec, /RealBroks/);
  assert.doesNotMatch(vm, /RealBroks|Tecstellar/);
  assert.match(vm, /Vanmoh Chit Funds/);
  assert.match(vm, /"Created first listing" = has joined a group/);
  for (const p of [tec, vm]) assert.match(p, /outcome must be exactly one of: Interested \| Very interested/);
});
