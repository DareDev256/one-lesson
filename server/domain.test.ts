import { describe, expect, it } from 'vitest';
import { blockingRule, computeTags, HOMES, validateSteps } from './domain';

describe('safety tags are deterministic', () => {
  it('a knife placed in the low drawer is sharp + child-reach', () => {
    const tags = computeTags([
      { action: 'pick', objectType: 'knife' },
      { action: 'place', targetType: 'low_drawer' },
    ]);
    expect(tags).toContain('sharp+child-reach');
  });

  it('a knife placed high is sharp, but not a child-reach hazard', () => {
    const tags = computeTags([
      { action: 'pick', objectType: 'knife' },
      { action: 'place', targetType: 'high_cabinet' },
    ]);
    expect(tags).toEqual(['sharp']);
  });

  it('a plate in the low drawer is not a sharp hazard', () => {
    const tags = computeTags([
      { action: 'pick', objectType: 'plate' },
      { action: 'place', targetType: 'low_drawer' },
    ]);
    expect(tags).not.toContain('sharp+child-reach');
  });
});

describe('home rules', () => {
  const kids = HOMES.find((h) => h.hasKids)!;
  const noKids = HOMES.find((h) => !h.hasKids)!;
  const knifeLow = computeTags([
    { action: 'pick', objectType: 'knife' },
    { action: 'place', targetType: 'low_drawer' },
  ]);

  it("a kids' home refuses the knife-low lesson and names the rule", () => {
    expect(blockingRule(knifeLow, kids.blockedTags)).toBe('sharp+child-reach');
  });

  it('a home with no kids accepts it', () => {
    expect(blockingRule(knifeLow, noKids.blockedTags)).toBeNull();
  });

  it('rejects malformed steps', () => {
    expect(() => validateSteps([{ action: 'pick', objectType: 'chainsaw' }])).toThrow();
    expect(() => validateSteps([])).toThrow();
  });
});
