const DEFAULT_BUCKET_COUNT = 10000;

/**
 * FNV-1a 32-bit hash. Chosen because it is tiny, dependency-free, and
 * deterministic across runtimes. We only need a stable bucket, not
 * cryptographic strength.
 */
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Map an arbitrary string to a float in [0, 1). The bucket count is a power
 * of two so the modulo is cheap and the distribution is uniform enough for
 * percentage rollouts.
 */
export function hashStringToUnitInterval(key, bucketCount = DEFAULT_BUCKET_COUNT) {
  if (!Number.isInteger(bucketCount) || bucketCount <= 0) {
    throw new RangeError('bucketCount must be a positive integer');
  }
  const bucket = fnv1a32(String(key)) % bucketCount;
  return bucket / bucketCount;
}

function clampPercentage(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError('percentage must be a number');
  }
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function validateOverrideList(list, label) {
  if (!Array.isArray(list)) {
    throw new TypeError(`${label} must be an array`);
  }
  for (const entry of list) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new TypeError(`${label} entries must be non-empty strings`);
    }
  }
}

function normalizeRule(rule) {
  if (rule === null || typeof rule !== 'object') {
    throw new TypeError('rule must be an object');
  }
  const name = rule.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('rule.name must be a non-empty string');
  }

  let percentage = 100;
  if (rule.percentage !== undefined) {
    percentage = clampPercentage(rule.percentage);
  }

  const allow = rule.allow === undefined ? [] : rule.allow;
  const deny = rule.deny === undefined ? [] : rule.deny;
  validateOverrideList(allow, 'rule.allow');
  validateOverrideList(deny, 'rule.deny');

  return {
    name,
    percentage,
    allow: allow.slice(),
    deny: deny.slice(),
  };
}

/**
 * Normalize a rule or array of rules into a flat list. A single rule object
 * is accepted for convenience, but the canonical form is an array so that
 * evaluation order is explicit and deterministic.
 */
export function normalizeRules(rules) {
  if (rules === undefined || rules === null) {
    return [];
  }
  if (Array.isArray(rules)) {
    return rules.map(normalizeRule);
  }
  return [normalizeRule(rules)];
}

/**
 * Evaluate a single rule for a given user key. Overrides are checked before
 * the percentage rollout so that a deny can always block a user, and an allow
 * can always admit a user, regardless of the rollout number.
 */
export function evaluateFlag(rule, key) {
  if (rule === null || typeof rule !== 'object') {
    throw new TypeError('rule must be an object');
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('key must be a non-empty string');
  }

  const allow = rule.allow || [];
  const deny = rule.deny || [];

  if (deny.includes(key)) {
    return { enabled: false, reason: 'deny' };
  }
  if (allow.includes(key)) {
    return { enabled: true, reason: 'allow' };
  }

  const percentage = clampPercentage(rule.percentage === undefined ? 100 : rule.percentage);
  if (percentage <= 0) {
    return { enabled: false, reason: 'percentage' };
  }
  if (percentage >= 100) {
    return { enabled: true, reason: 'percentage' };
  }

  const bucket = hashStringToUnitInterval(key);
  const threshold = percentage / 100;
  return { enabled: bucket < threshold, reason: 'percentage' };
}

/**
 * A small container that holds named rules and evaluates them in order.
 * The first rule that yields enabled=true wins; if none do, the flag is off.
 * This ordering makes it possible to express "allowlist first, then rollout".
 */
export class FeatureFlags {
  constructor(rules = {}) {
    if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
      throw new TypeError('rules must be a plain object mapping flag names to rule definitions');
    }
    this._rules = new Map();
    for (const [name, definition] of Object.entries(rules)) {
      if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('flag names must be non-empty strings');
      }
      this._rules.set(name, normalizeRules(definition));
    }
  }

  /**
   * Return whether a flag is enabled for a key. Unknown flags are off, which
   * is the safe default for feature flags: a typo should not turn a feature on.
   */
  isEnabled(flagName, key) {
    if (typeof flagName !== 'string' || flagName.length === 0) {
      throw new TypeError('flagName must be a non-empty string');
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('key must be a non-empty string');
    }
    const rules = this._rules.get(flagName);
    if (!rules) {
      return false;
    }
    for (const rule of rules) {
      const result = evaluateFlag(rule, key);
      if (result.enabled) {
        return true;
      }
    }
    return false;
  }

  /**
   * Expose the normalized rules for inspection and testing. The returned
   * structure is a deep copy so callers cannot mutate internal state.
   */
  getRules(flagName) {
    const rules = this._rules.get(flagName);
    if (!rules) {
      return undefined;
    }
    return rules.map((rule) => ({
      name: rule.name,
      percentage: rule.percentage,
      allow: rule.allow.slice(),
      deny: rule.deny.slice(),
    }));
  }

  /**
   * List the flag names this instance knows about, sorted for deterministic
   * output.
   */
  listFlags() {
    return Array.from(this._rules.keys()).sort();
  }
}
