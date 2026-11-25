import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildFeed, checkFeed, FEED_VERSION, joinStations, recordsOf, toPence } from './feed.mjs';

describe('toPence', () => {
  for (const [raw, expected] of [
    [145.9, 145.9],
    ['152.7', 152.7],
    [1.459, 145.9], // reported in pounds
    [0.5, null], // 50p: data error
    [1590, null], // £15.90: data error
    [null, null],
    ['n/a', null],
  ]) {
    it(`${JSON.stringify(raw)} -> ${expected}`, () => assert.equal(toPence(raw), expected));
  }
});

describe('recordsOf', () => {
  it('accepts a bare array or { data }', () => {
    assert.deepEqual(recordsOf([1]), [1]);
    assert.deepEqual(recordsOf({ data: [2] }), [2]);
    assert.deepEqual(recordsOf({ success: false }), []);
  });
});

describe('joinStations', () => {
  const pfs = [
    {
      node_id: 'a',
      trading_name: 'Tesco Extra',
      brand_name: 'TESCO',
      temporary_closure: false,
      is_supermarket_service_station: true,
      location: { address_line_1: '1 High St', city: 'Newmarket', postcode: 'CB8 1AA', latitude: 52.2412345, longitude: 0.4 },
    },
    { node_id: 'closed', trading_name: 'X', temporary_closure: true, location: { latitude: 52, longitude: 0 } },
    { node_id: 'gone', trading_name: 'X', permanent_closure: true, location: { latitude: 52, longitude: 0 } },
    { node_id: 'nowhere', trading_name: 'Y', location: { latitude: null, longitude: null } },
    { node_id: 'abroad', trading_name: 'Y', location: { latitude: 40.4, longitude: -3.7 } },
    { node_id: 'no-prices', trading_name: 'Z', location: { latitude: 52, longitude: 0 } },
  ];
  const prices = [
    { node_id: 'a', fuel_prices: [{ fuel_type: 'E10', price: '139.9' }, { fuel_type: 'B7_STANDARD', price: 0.5 }] },
    ...['closed', 'gone', 'nowhere', 'abroad'].map((id) => ({ node_id: id, fuel_prices: [{ fuel_type: 'E10', price: 130 }] })),
  ];

  it('keeps open, located stations with plausible prices', () => {
    assert.deepEqual(joinStations(pfs, prices), [
      {
        id: 'a',
        name: 'Tesco Extra',
        brand: 'TESCO',
        address: '1 High St, Newmarket',
        postcode: 'CB8 1AA',
        lat: 52.24123,
        lon: 0.4,
        motorway: false,
        supermarket: true,
        prices: { E10: 139.9 },
      },
    ]);
  });
});

describe('buildFeed / checkFeed', () => {
  const station = (e10) => ({ id: 'x', prices: e10 ? { E10: 140 } : { B7_STANDARD: 145 } });

  it('wraps stations with version, time and licence', () => {
    const feed = buildFeed([station(true)], new Date('2026-11-25T14:00:00Z'));
    assert.equal(feed.version, FEED_VERSION);
    assert.equal(feed.generatedAt, '2026-11-25T14:00:00.000Z');
    assert.equal(feed.count, 1);
    assert.match(feed.licence, /Open Government Licence/);
  });

  it('refuses feeds that are too small or missing petrol prices', () => {
    assert.deepEqual(checkFeed(buildFeed([station(true), station(true)]), 2), []);
    assert.equal(checkFeed(buildFeed([station(true)]), 2).length, 1);
    assert.equal(checkFeed(buildFeed([station(false), station(false), station(true)]), 1).length, 1);
  });
});
