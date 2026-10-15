import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerCsvTemplate, parseCustomerCsv, type StateCatalogEntry } from '../customerImport.ts';

const HEADER = 'app,name,phone,business,city,state,plan,listings,buyers,registered_at,language,owner_agent_id';

const STATES: StateCatalogEntry[] = [
  { name: 'Tamil Nadu', language: 'Tamil', cities: ['Chennai', 'Coimbatore'] },
  { name: 'Kerala', language: 'Malayalam', cities: ['Kochi'] },
];

const parse = (csv: string) => parseCustomerCsv(csv, STATES);

test('parses a well-formed row into a fresh CustomerUser', () => {
  const csv = `${HEADER}\nrealbroks,Suresh Kumar,9876543210,Suresh Properties,Chennai,Tamil Nadu,Paid,3,1,2026-01-15,Tamil,ravi-s`;
  const { customers, errors } = parse(csv);
  assert.deepEqual(errors, []);
  assert.equal(customers.length, 1);
  const c = customers[0];
  assert.equal(c.id, 'cust-919876543210');
  assert.equal(c.phone, '+919876543210');
  assert.equal(c.name, 'Suresh Kumar');
  assert.equal(c.app, 'realbroks');
  assert.equal(c.plan, 'Paid');
  assert.equal(c.paying, true);
  assert.equal(c.queue, 'new');
  assert.equal(c.attempt, 0);
  assert.deepEqual(c.callHistory, []);
  assert.equal(c.ownerAgentId, 'ravi-s');
});

test('defaults city/state/language from state defs when left blank', () => {
  const csv = `${HEADER}\nirondrobe,Meena Reddy,8870000000,,,,,,,,,`;
  const { customers, errors } = parse(csv);
  assert.deepEqual(errors, []);
  assert.equal(customers[0].city, 'Chennai');
  assert.equal(customers[0].effectiveState, 'Tamil Nadu');
  assert.equal(customers[0].language, 'English');
  assert.equal(customers[0].business, 'Meena Reddy');
});

test('rejects an unknown app without failing the whole file', () => {
  const csv = `${HEADER}\nnotarealapp,A,9876543210,,,,,,,,,\nrealbroks,B,9876543211,,,,,,,,,`;
  const { customers, errors } = parse(csv);
  assert.equal(customers.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Unknown app/);
  assert.equal(errors[0].row, 2);
});

test('rejects an unparseable phone number', () => {
  const csv = `${HEADER}\nrealbroks,A,not-a-phone,,,,,,,,,`;
  const { customers, errors } = parse(csv);
  assert.equal(customers.length, 0);
  assert.match(errors[0].message, /Invalid phone/);
});

test('rejects a row missing the name', () => {
  const csv = `${HEADER}\nrealbroks,,9876543210,,,,,,,,,`;
  const { customers, errors } = parse(csv);
  assert.equal(customers.length, 0);
  assert.match(errors[0].message, /Missing name/);
});

test('flags a duplicate phone within the same file, keeping the first', () => {
  const csv = `${HEADER}\nrealbroks,A,9876543210,,,,,,,,,\nirondrobe,B,9876543210,,,,,,,,,`;
  const { customers, errors } = parse(csv);
  assert.equal(customers.length, 1);
  assert.equal(customers[0].name, 'A');
  assert.match(errors[0].message, /Duplicate phone/);
});

test('requires at minimum app, name and phone columns in the header', () => {
  const { customers, errors } = parse('name,phone\nA,9876543210');
  assert.equal(customers.length, 0);
  assert.match(errors[0].message, /Header must include/);
});

test('handles quoted fields with embedded commas (business names, addresses)', () => {
  const csv = `${HEADER}\nrealbroks,A,9876543210,"Suresh, Kumar & Sons",Chennai,Tamil Nadu,,,,,,`;
  const { customers } = parse(csv);
  assert.equal(customers[0].business, 'Suresh, Kumar & Sons');
});

test('the downloadable template parses back with zero errors', () => {
  const { customers, errors } = parse(customerCsvTemplate());
  assert.deepEqual(errors, []);
  assert.equal(customers.length, 1);
});
