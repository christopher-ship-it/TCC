import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRecordingFile } from '../providers/telecmi/adapter.ts';

test('finds an audio file name in strings, URLs and nested payloads', () => {
  assert.equal(findRecordingFile('1789891978559_1000085196885_5002_33338836.mp3'), '1789891978559_1000085196885_5002_33338836.mp3');
  assert.equal(findRecordingFile('https://connle.telecmi.com/connly_voice/download_music/abc_5002_33338836.mp3?inet_no=33338836'), 'abc_5002_33338836.mp3');
  assert.equal(findRecordingFile({ call_id: 'x', data: { filename: 'r_1.wav' } }), 'r_1.wav');
  assert.equal(findRecordingFile({ record: true, files: ['a.ogg'] }), 'a.ogg');
});

test('returns undefined when there is no audio file in the payload', () => {
  assert.equal(findRecordingFile({ call_id: 'x', state: 'started' }), undefined);
  assert.equal(findRecordingFile(null), undefined);
  assert.equal(findRecordingFile('notes.txt'), undefined);
});
