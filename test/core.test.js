import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FeatureFlags,
  evaluateFlag,
  normalizeRules,
  hashStringToUnitInterval,
} from '../src/index.js';

test('hashStringToUnitInterval returns a value in [0, 1)', () => {
  const value = hashStringToUnitInterval('alice');
  assert.ok(value >= 0 && value < 1);
});

test('hashStringToUnitInterval is deterministic', () => {
  assert.equal(hashStringToUnitInterval('alice'), hashStringToUnitInterval('alice'));
  assert.notEqual(hashStringToUnitInterval('alice'), hashStringToUnitInterval('bob'));
});

test('hashStringToUnitInterval respects a custom bucket count', () => {
  const value = hashStringToUnitInterval('alice', 100);
  assert.ok(value >= 0 && value < 1);
  assert.ok(Number.isInteger(Math.round(value * 100)));
});

test('hashStringToUnitInterval rejects invalid bucket counts', () => {
  assert.throws(() => hashStringToUnitInterval('alice', 0), RangeError);
  assert.throws(() => hashStringToUnitInterval('alice', -1), RangeError);
  assert.throws(() => hashStringToUnitInterval('alice', 1.5), RangeError);
});

test('evaluateFlag denies a key in the deny list', () => {
  const result = evaluateFlag({ name: 'r', percentage: 100, allow: [], deny: ['alice'] }, 'alice');
  assert.deepEqual(result, { enabled: false, reason: 'deny' });
});

test('evaluateFlag allows a key in the allow list', () => {
  const result = evaluateFlag({ name: 'r', percentage: 0, allow: ['alice'], deny: [] }, 'alice');
  assert.deepEqual(result, { enabled: true, reason: 'allow' });
});

test('evaluateFlag deny wins over allow when both contain the key', () => {
  const result = evaluateFlag(
    { name: 'r', percentage: 100, allow: ['alice'], deny: ['alice'] },
    'alice',
  );
  assert.deepEqual(result, { enabled: false, reason: 'deny' });
});

test('evaluateFlag returns false at 0 percent and true at 100 percent', () => {
  assert.deepEqual(
    evaluateFlag({ name: 'r', percentage: 0, allow: [], deny: [] }, 'alice'),
    { enabled: false, reason: 'percentage' },
  );
  assert.deepEqual(
    evaluateFlag({ name: 'r', percentage: 100, allow: [], deny: [] }, 'alice'),
    { enabled: true, reason: 'percentage' },
  );
});

test('evaluateFlag clamps out-of-range percentages', () => {
  assert.deepEqual(
    evaluateFlag({ name: 'r', percentage: -10, allow: [], deny: [] }, 'alice'),
    { enabled: false, reason: 'percentage' },
  );
  assert.deepEqual(
    evaluateFlag({ name: 'r', percentage: 250, allow: [], deny: [] }, 'alice'),
    { enabled: true, reason: 'percentage' },
  );
});

test('evaluateFlag performs a percentage rollout deterministically', () => {
  const rule = { name: 'r', percentage: 50, allow: [], deny: [] };
  const first = evaluateFlag(rule, 'alice');
  const second = evaluateFlag(rule, 'alice');
  assert.deepEqual(first, second);
  assert.equal(typeof first.enabled, 'boolean');
});

test('evaluateFlag rejects invalid keys and rules', () => {
  assert.throws(() => evaluateFlag({ name: 'r' }, ''), TypeError);
  assert.throws(() => evaluateFlag(null, 'alice'), TypeError);
});

test('normalizeRules accepts a single rule and an array', () => {
  const single = normalizeRules({ name: 'r', percentage: 10 });
  assert.equal(single.length, 1);
  assert.equal(single[0].name, 'r');
  assert.equal(single[0].percentage, 10);
  assert.deepEqual(single[0].allow, []);
  assert.deepEqual(single[0].deny, []);

  const many = normalizeRules([
    { name: 'a', percentage: 0 },
    { name: 'b', percentage: 100 },
  ]);
  assert.equal(many.length, 2);
  assert.equal(many[0].name, 'a');
  assert.equal(many[1].name, 'b');
});

test('normalizeRules rejects malformed input', () => {
  assert.throws(() => normalizeRules({ percentage: 10 }), TypeError);
  assert.throws(() => normalizeRules({ name: 'r', allow: 'alice' }), TypeError);
  assert.throws(() => normalizeRules({ name: 'r', deny: [42] }), TypeError);
});

test('FeatureFlags evaluates rules in order and stops at the first match', () => {
  const flags = new FeatureFlags({
    checkout: [
      { name: 'allow-testers', percentage: 0, allow: ['tester-1'], deny: [] },
      { name: 'rollout', percentage: 100, allow: [], deny: [] },
    ],
  });

  assert.equal(flags.isEnabled('checkout', 'tester-1'), true);
  assert.equal(flags.isEnabled('checkout', 'regular-user'), true);
});

test('FeatureFlags returns false for unknown flags', () => {
  const flags = new FeatureFlags({});
  assert.equal(flags.isEnabled('missing', 'alice'), false);
});

test('FeatureFlags getRules returns a copy that cannot mutate internal state', () => {
  const flags = new FeatureFlags({
    beta: { name: 'beta-rule', percentage: 25, allow: ['alice'], deny: ['bob'] },
  });

  const rules = flags.getRules('beta');
  assert.equal(rules.length, 1);
  rules[0].allow.push('mallory');
  rules[0].percentage = 100;

  const fresh = flags.getRules('beta');
  assert.deepEqual(fresh[0].allow, ['alice']);
  assert.equal(fresh[0].percentage, 25);
});

test('FeatureFlags listFlags returns sorted names', () => {
  const flags = new FeatureFlags({
    zeta: { name: 'z', percentage: 0 },
    alpha: { name: 'a', percentage: 0 },
  });
  assert.deepEqual(flags.listFlags(), ['alpha', 'zeta']);
});

test('FeatureFlags rejects malformed constructor input', () => {
  assert.throws(() => new FeatureFlags(null), TypeError);
  assert.throws(() => new FeatureFlags([]), TypeError);
  assert.throws(() => new FeatureFlags({ '': { name: 'r' } }), TypeError);
});

test('FeatureFlags isEnabled validates its arguments', () => {
  const flags = new FeatureFlags({});
  assert.throws(() => flags.isEnabled('', 'alice'), TypeError);
  assert.throws(() => flags.isEnabled('flag', ''), TypeError);
});
