import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTitle, extractLinks, extractText } from '../src/crawler/htmlParser.js';

describe('extractTitle', () => {
  it('extracts title from HTML', () => {
    assert.equal(extractTitle('<html><head><title>My Page</title></head></html>'), 'My Page');
  });

  it('returns empty string when no title', () => {
    assert.equal(extractTitle('<html><head></head></html>'), '');
  });

  it('decodes HTML entities', () => {
    assert.equal(extractTitle('<title>Tom &amp; Jerry</title>'), 'Tom & Jerry');
  });
});

describe('extractLinks', () => {
  it('extracts href attributes from anchors', () => {
    const html = '<a href="/about">About</a><a href="https://example.com">Home</a>';
    const links = extractLinks(html);
    assert.deepEqual(links, ['/about', 'https://example.com']);
  });

  it('deduplicates links', () => {
    const html = '<a href="/page">A</a><a href="/page">B</a>';
    assert.equal(extractLinks(html).length, 1);
  });

  it('handles single quotes', () => {
    const html = "<a href='/test'>Test</a>";
    assert.deepEqual(extractLinks(html), ['/test']);
  });
});

describe('extractText', () => {
  it('strips script and style tags', () => {
    const html = '<p>Hello</p><script>alert("x")</script><style>.x{}</style><p>World</p>';
    const text = extractText(html);
    assert.ok(text.includes('Hello'));
    assert.ok(text.includes('World'));
    assert.ok(!text.includes('alert'));
    assert.ok(!text.includes('.x'));
  });

  it('strips HTML tags', () => {
    const text = extractText('<div><p>Some <b>bold</b> text</p></div>');
    assert.ok(text.includes('Some'));
    assert.ok(text.includes('bold'));
    assert.ok(text.includes('text'));
    assert.ok(!text.includes('<'));
  });
});
