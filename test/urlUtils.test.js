import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, shouldSkipByExtension, isValidCrawlUrl } from '../src/crawler/urlUtils.js';

describe('normalizeUrl', () => {
  it('lowercases hostname', () => {
    assert.equal(normalizeUrl('https://EXAMPLE.COM/path'), 'https://example.com/path');
  });

  it('strips fragments', () => {
    assert.equal(normalizeUrl('https://example.com/page#section'), 'https://example.com/page');
  });

  it('strips default ports', () => {
    assert.equal(normalizeUrl('https://example.com:443/path'), 'https://example.com/path');
    assert.equal(normalizeUrl('http://example.com:80/path'), 'http://example.com/path');
  });

  it('removes trailing slash except root', () => {
    assert.equal(normalizeUrl('https://example.com/path/'), 'https://example.com/path');
    assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
  });

  it('resolves relative URLs', () => {
    assert.equal(
      normalizeUrl('/about', 'https://example.com/page'),
      'https://example.com/about'
    );
  });

  it('rejects non-HTTP protocols', () => {
    assert.equal(normalizeUrl('mailto:test@example.com'), null);
    assert.equal(normalizeUrl('javascript:void(0)'), null);
    assert.equal(normalizeUrl('ftp://example.com'), null);
  });

  it('returns null for empty or invalid URLs', () => {
    assert.equal(normalizeUrl(''), null);
    assert.equal(normalizeUrl('not-a-url'), null);
  });

  it('sorts query parameters', () => {
    const result = normalizeUrl('https://example.com/page?b=2&a=1');
    assert.equal(result, 'https://example.com/page?a=1&b=2');
  });
});

describe('shouldSkipByExtension', () => {
  it('skips image files', () => {
    assert.equal(shouldSkipByExtension('https://example.com/image.png'), true);
    assert.equal(shouldSkipByExtension('https://example.com/image.jpg'), true);
  });

  it('does not skip HTML-like URLs', () => {
    assert.equal(shouldSkipByExtension('https://example.com/page'), false);
    assert.equal(shouldSkipByExtension('https://example.com/page.html'), false);
  });
});

describe('isValidCrawlUrl', () => {
  it('accepts http and https', () => {
    assert.equal(isValidCrawlUrl('https://example.com'), true);
    assert.equal(isValidCrawlUrl('http://example.com'), true);
  });

  it('rejects non-http', () => {
    assert.equal(isValidCrawlUrl('ftp://example.com'), false);
    assert.equal(isValidCrawlUrl(''), false);
    assert.equal(isValidCrawlUrl(null), false);
  });
});
