import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scorePage, rankResults } from '../src/indexer/relevance.js';

describe('scorePage', () => {
  it('scores title matches higher than body matches', () => {
    const page = { title: 'Node.js Crawler Guide', body_text: 'Some generic content here' };
    const titleMatches = [{ field: 'title', frequency: 1, term: 'crawler' }];
    const bodyMatches = [{ field: 'body', frequency: 1, term: 'crawler' }];

    const titleScore = scorePage('crawler', page, titleMatches);
    const bodyScore = scorePage('crawler', page, bodyMatches);

    assert.ok(titleScore > bodyScore, `Title score (${titleScore}) should be > body score (${bodyScore})`);
  });

  it('scores URL matches at +2 per frequency', () => {
    const page = { title: 'Some Page', body_text: 'Some content' };
    const urlMatches = [{ field: 'url', frequency: 2, term: 'blog' }];

    const score = scorePage('blog', page, urlMatches);
    // URL match: 2 * 2 = 4, no phrase bonus
    assert.ok(score >= 4, `URL score should be >= 4, got ${score}`);
  });

  it('applies phrase bonus when query appears in title', () => {
    const page = { title: 'web crawler tutorial', body_text: 'Learn about crawling' };
    const noMatches = [];

    const score = scorePage('web crawler', page, noMatches);
    // Phrase bonus for title: +10
    assert.ok(score >= 10, `Phrase bonus in title should give >= 10, got ${score}`);
  });

  it('applies phrase bonus when query appears in body', () => {
    const page = { title: 'Tutorial', body_text: 'learn how to build a web crawler from scratch' };
    const noMatches = [];

    const score = scorePage('web crawler', page, noMatches);
    // Phrase bonus for body: +3
    assert.ok(score >= 3, `Phrase bonus in body should give >= 3, got ${score}`);
  });

  it('accumulates title and body phrase bonus together', () => {
    const page = { title: 'web crawler', body_text: 'this is about web crawler design' };
    const matches = [
      { field: 'title', frequency: 1, term: 'web' },
      { field: 'title', frequency: 1, term: 'crawler' },
    ];

    const score = scorePage('web crawler', page, matches);
    // title matches: 5*1 + 5*1 = 10, phrase in title: +10, phrase in body: +3 = 23
    assert.ok(score >= 23, `Combined score should be >= 23, got ${score}`);
  });

  it('returns 0 for empty query', () => {
    const page = { title: 'Test', body_text: 'Content' };
    const score = scorePage('', page, []);
    assert.equal(score, 0);
  });

  it('uses log(1 + tf) for body frequency weighting', () => {
    const page = { title: 'Unrelated', body_text: 'no match here' };
    const lowTf = [{ field: 'body', frequency: 1, term: 'search' }];
    const highTf = [{ field: 'body', frequency: 100, term: 'search' }];

    const lowScore = scorePage('search', page, lowTf);
    const highScore = scorePage('search', page, highTf);

    // log scaling means 100x frequency does NOT give 100x score
    assert.ok(highScore > lowScore, 'Higher TF should score higher');
    assert.ok(highScore < lowScore * 50, 'Log scaling should prevent linear growth');
  });
});

describe('rankResults', () => {
  it('sorts results by score descending', () => {
    const results = [
      { score: 3, relevant_url: 'a' },
      { score: 8, relevant_url: 'b' },
      { score: 5, relevant_url: 'c' },
    ];
    const ranked = rankResults(results);
    assert.equal(ranked[0].relevant_url, 'b');
    assert.equal(ranked[1].relevant_url, 'c');
    assert.equal(ranked[2].relevant_url, 'a');
  });

  it('filters out results with score <= 0', () => {
    const results = [
      { score: 5, relevant_url: 'a' },
      { score: 0, relevant_url: 'b' },
      { score: -1, relevant_url: 'c' },
    ];
    const ranked = rankResults(results);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].relevant_url, 'a');
  });

  it('returns empty array when all scores are 0', () => {
    const results = [
      { score: 0, relevant_url: 'a' },
      { score: 0, relevant_url: 'b' },
    ];
    const ranked = rankResults(results);
    assert.equal(ranked.length, 0);
  });
});
