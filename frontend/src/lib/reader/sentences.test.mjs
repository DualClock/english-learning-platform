import test from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoSentences } from './sentences.ts';

test('обычные предложения делятся по границам', () => {
  assert.deepEqual(splitIntoSentences('One two. Three four! Five?'), [
    'One two.',
    'Three four!',
    'Five?',
  ]);
});

test('сокращения и инициалы не рвут предложение', () => {
  assert.deepEqual(splitIntoSentences('Mr. Smith went home. Dr. Jones stayed.'), [
    'Mr. Smith went home.',
    'Dr. Jones stayed.',
  ]);
  assert.deepEqual(splitIntoSentences('The U.S.A. is large. Yes.'), [
    'The U.S.A. is large.',
    'Yes.',
  ]);
});

test('десятичные числа не становятся концом предложения', () => {
  assert.deepEqual(splitIntoSentences('It cost 3.14 dollars. That is all.'), [
    'It cost 3.14 dollars.',
    'That is all.',
  ]);
});

test('закрывающие кавычки остаются в предложении', () => {
  assert.deepEqual(splitIntoSentences('She said, "Hello." Then she left.'), [
    'She said, "Hello."',
    'Then she left.',
  ]);
});

test('многоточие не дробит фразу на три предложения', () => {
  assert.deepEqual(splitIntoSentences('Wait... What?'), ['Wait...', 'What?']);
});

test('точка без пробела после неё не режет текст', () => {
  assert.deepEqual(splitIntoSentences('No space.after dot'), ['No space.after dot']);
});

test('пустой текст не создаёт пустых предложений', () => {
  assert.deepEqual(splitIntoSentences(''), []);
  assert.deepEqual(splitIntoSentences('   '), []);
});

test('последний хвост без знака не теряется', () => {
  assert.deepEqual(splitIntoSentences('First. Second without end'), [
    'First.',
    'Second without end',
  ]);
});
