import assert from 'node:assert/strict';
import { test } from 'node:test';
import india from '@svg-maps/india';
import { MAP_STATES, canonicalState, dominantLanguage, mapStateOf, stateStats } from '../geo.ts';

test('every state we count is a state the map draws, and the other way round', () => {
  const drawn = (india as { locations: { name: string }[] }).locations.map((l) => l.name).sort();
  assert.deepEqual([...MAP_STATES].sort(), drawn);
});

test('the spellings products use all land on the map’s names', () => {
  const cases: [string, string | null][] = [
    ['Tamil Nadu', 'Tamil Nadu'], ['  tamil nadu ', 'Tamil Nadu'], ['TamilNadu', 'Tamil Nadu'], ['Orissa', 'Odisha'], ['Jammu & Kashmir', 'Jammu and Kashmir'],
    ['Ladakh', 'Jammu and Kashmir'], ['NCT of Delhi', 'Delhi'], ['Pondicherry', 'Puducherry'], ['Andaman & Nicobar Islands', 'Andaman and Nicobar Islands'],
    ['Dadra and Nagar Haveli and Daman and Diu', 'Dadra and Nagar Haveli'], ['Atlantis', null], ['', null], [null as never, null],
  ];
  for (const [raw, want] of cases) assert.equal(canonicalState(raw), want, String(raw));
});

test('a customer is drawn in the state the product sent, else the one TCC knows', () => {
  assert.equal(mapStateOf({ stateName: 'Gujarat', state: null }), 'Gujarat');
  assert.equal(mapStateOf({ stateName: undefined, state: 'Kerala' }), 'Kerala');
  assert.equal(mapStateOf({ stateName: 'Nowhere', state: 'Kerala' }), 'Kerala');
  assert.equal(mapStateOf({ stateName: undefined, state: null }), null);
});

test('counts customers by state and by language, and keeps those with no state apart', () => {
  const u = (stateName: string | undefined, language: 'Tamil' | 'Hindi', over = {}) => ({ stateName, state: null, language, active: true, paying: false, mrr: 0, ...over }) as never;
  const { byState, unknown } = stateStats([u('Tamil Nadu', 'Tamil'), u('Tamil Nadu', 'Tamil', { paying: true, mrr: 500 }), u('Goa', 'Hindi'), u(undefined, 'Tamil'), u('Kerala', 'Tamil', { deleted: { ts: 1 } })]);
  assert.equal(byState.get('Tamil Nadu')?.customers, 2);
  assert.equal(byState.get('Tamil Nadu')?.paying, 1);
  assert.equal(byState.get('Tamil Nadu')?.mrr, 500);
  assert.equal(byState.get('Goa')?.language, 'Hindi');
  assert.equal(byState.has('Kerala'), false, 'deleted customers are not counted');
  assert.equal(unknown.customers, 1);
  assert.equal(dominantLanguage({ ...byState.get('Tamil Nadu')!, byLanguage: { Tamil: 1, Hindi: 3 } }), 'Hindi');
});
