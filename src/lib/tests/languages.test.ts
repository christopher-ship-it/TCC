import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerLanguageFrom, languageForState, primaryLanguageOf } from '../languages.ts';

test('every state gets the language the team agreed on', () => {
  assert.equal(languageForState('Tamil Nadu'), 'Tamil');
  assert.equal(languageForState('Puducherry'), 'Tamil');
  assert.equal(languageForState('Kerala'), 'Malayalam');
  assert.equal(languageForState('Andhra Pradesh'), 'Telugu');
  assert.equal(languageForState('Telangana'), 'Telugu');
  assert.equal(languageForState('Karnataka'), 'Kannada');
  for (const s of ['Maharashtra', 'Goa', 'Lakshadweep', 'West Bengal', 'Delhi']) assert.equal(languageForState(s), 'Hindi');
});

test('what a product sends is read as one of our languages, English is never one', () => {
  assert.equal(customerLanguageFrom('ta'), 'Tamil');
  assert.equal(customerLanguageFrom(' Malayalam '), 'Malayalam');
  assert.equal(customerLanguageFrom('bn'), 'Hindi');
  assert.equal(customerLanguageFrom('others'), 'Others');
  assert.equal(customerLanguageFrom('en'), null);
  assert.equal(customerLanguageFrom('mr'), null);
  assert.equal(customerLanguageFrom(null), null);
});

test('primary language is never English and always one the person speaks', () => {
  assert.equal(primaryLanguageOf({ languages: ['English', 'Tamil'] }), 'Tamil');
  assert.equal(primaryLanguageOf({ languages: ['Tamil', 'Hindi'], primaryLanguage: 'Hindi' }), 'Hindi');
  assert.equal(primaryLanguageOf({ languages: ['Tamil'], primaryLanguage: 'Hindi' }), 'Tamil');
  assert.equal(primaryLanguageOf({ languages: ['Tamil', 'English'], primaryLanguage: 'English' }), 'Tamil');
  assert.equal(primaryLanguageOf({ languages: ['English'] }), null);
});
