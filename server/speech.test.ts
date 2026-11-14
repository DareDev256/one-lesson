import { describe, expect, it } from 'vitest';
import { computeTags, parseSpokenLesson } from './domain';

describe('spoken lessons parse deterministically', () => {
  it('names the skill from a short first sentence and shares one target across objects', () => {
    const r = parseSpokenLesson('Kitchen tidy. Put the knife and the scissors in the bottom drawer');
    expect(r.title).toBe('kitchen tidy');
    expect(r.steps).toEqual([
      { action: 'pick', objectType: 'knife' }, { action: 'place', targetType: 'low_drawer' },
      { action: 'pick', objectType: 'scissors' }, { action: 'place', targetType: 'low_drawer' },
    ]);
    expect(computeTags(r.steps)).toContain('sharp+child-reach');
  });

  it('follows the order things are said', () => {
    const r = parseSpokenLesson('Load the dishwasher. Put the plate in the dishwasher, then put the cup in the dishwasher.');
    expect(r.title).toBe('load the dishwasher');
    expect(r.steps.map((s) => (s.action === 'pick' ? s.objectType : s.targetType))).toEqual(['plate', 'dishwasher', 'cup', 'dishwasher']);
  });

  it('understands "call it" and multi-word places', () => {
    const r = parseSpokenLesson('Put the pan in the sink and the knife on the top shelf. Call it evening reset.');
    expect(r.title).toBe('evening reset');
    expect(r.steps.map((s) => (s.action === 'pick' ? s.objectType : s.targetType))).toEqual(['pan', 'sink', 'knife', 'high_cabinet']);
  });

  it('reports objects that never got a place', () => {
    const r = parseSpokenLesson('pick up the bowl');
    expect(r.steps).toEqual([]);
    expect(r.leftover).toEqual(['bowl']);
  });
});
