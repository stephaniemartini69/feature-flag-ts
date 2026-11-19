# feature-flag-ts

A dependency-free feature flag evaluator with percentage rollouts and per-key override lists.

```js
import { FeatureFlags } from './src/index.js';

const flags = new FeatureFlags({
  checkout: [
    { name: 'allow-testers', percentage: 0, allow: ['tester-1'], deny: [] },
    { name: 'rollout', percentage: 25, allow: [], deny: ['banned-1'] },
  ],
});

flags.isEnabled('checkout', 'tester-1'); // true  (allow list)
flags.isEnabled('checkout', 'banned-1');  // false (deny list)
flags.isEnabled('checkout', 'regular');   // depends on the 25% rollout
```

## Why this exists

Feature flags usually start as a boolean and then grow two extra requirements: a gradual rollout and a way to force a specific user on or off. This library keeps that entire surface in a few hundred lines with no runtime dependencies, so it can be dropped into any ESM project without a build step or a network install.

The trade-off is deliberate: evaluation is pure and synchronous, and the caller supplies the key. There is no polling, no remote config, and no caching layer. That makes the behaviour easy to reason about and trivial to test, but it means the caller is responsible for fetching the rules and deciding which key represents a user.

## Awkward edge

Overrides always beat the percentage. A key in `deny` is off even at 100%, and a key in `allow` is on even at 0%. If a key appears in both lists, `deny` wins. This ordering is intentional: a ban should not be undone by a rollout number, and a manual allow should not be blocked by a low percentage. The rule list is evaluated in order, and the first rule that returns `true` wins; if no rule matches, the flag is off.

## API

### `new FeatureFlags(rules)`

`rules` is a plain object mapping flag names to a rule or an array of rules. Each rule has:

- `name` (string, required): a label for debugging.
- `percentage` (number, optional, default `100`): the share of keys that should be enabled. Values outside `[0, 100]` are clamped.
- `allow` (string[], optional): keys that are always enabled.
- `deny` (string[], optional): keys that are always disabled.

### `flags.isEnabled(flagName, key)`

Returns `true` if any rule for `flagName` enables `key`, otherwise `false`. Unknown flags are `false`.

### `flags.getRules(flagName)`

Returns a deep copy of the normalized rules for `flagName`, or `undefined` if the flag is unknown.

### `flags.listFlags()`

Returns the known flag names, sorted.

### `evaluateFlag(rule, key)`

Evaluates a single rule and returns `{ enabled, reason }`, where `reason` is one of `'deny'`, `'allow'`, or `'percentage'`.

### `normalizeRules(rules)`

Accepts a single rule or an array and returns a normalized array. Useful when building rules programmatically.

### `hashStringToUnitInterval(key, bucketCount = 10000)`

Maps a string to a float in `[0, 1)` using FNV-1a. Exported because rollout decisions are deterministic and callers may want to reproduce or inspect them.
