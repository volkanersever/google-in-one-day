import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, termFrequencies, tokenizeUrl } from '../src/indexer/tokenizer.js';

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric', () => {
    const tokens = tokenize('Hello World! This is a Test.');
    assert.ok(tokens.includes('hello'));
    assert.ok(tokens.includes('world'));
    assert.ok(tokens.includes('test'));
  });

  it('removes stopwords', () => {
    const tokens = tokenize('this is a test of the system');
    assert.ok(!tokens.includes('this'));
    assert.ok(!tokens.includes('is'));
    assert.ok(!tokens.includes('a'));
    assert.ok(!tokens.includes('of'));
    assert.ok(!tokens.includes('the'));
    assert.ok(tokens.includes('test'));
    assert.ok(tokens.includes('system'));
  });

  it('filters single-char tokens and stopwords', () => {
    const tokens = tokenize('a I go to me');
    assert.ok(!tokens.includes('a'));  // single char filtered
    assert.ok(!tokens.includes('me')); // stopword filtered
    assert.ok(tokens.includes('go'));  // 2 chars passes length filter
  });

  it('handles empty input', () => {
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize(null), []);
  });
});

describe('termFrequencies', () => {
  it('counts occurrences', () => {
    const freq = termFrequencies(['hello', 'world', 'hello']);
    assert.equal(freq.get('hello'), 2);
    assert.equal(freq.get('world'), 1);
  });
});

describe('tokenizeUrl', () => {
  it('extracts meaningful tokens from URL', () => {
    const tokens = tokenizeUrl('https://example.com/blog/my-article');
    assert.ok(tokens.includes('example'));
    assert.ok(tokens.includes('blog'));
    assert.ok(tokens.includes('article'));
  });
});
