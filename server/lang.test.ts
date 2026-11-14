import { describe, expect, it } from 'vitest';
import { detectLang, PROVENANCE_ASK } from './domain';

describe('language for Ask replies', () => {
  it('trusts a confident, allowed speech-model language', () => {
    expect(detectLang('range les couteaux et les ciseaux', { code: 'fra', probability: 0.99 })).toBe('fr');
    expect(detectLang('把刀和剑刀收好', { code: 'zho', probability: 0.96 })).toBe('zh');
  });
  it('falls back to the words when the model is unsure or outside the list (measured: Spanish heard as Esperanto, 0.27)', () => {
    expect(detectLang('Recoge la cocina', { code: 'epo', probability: 0.27 })).toBe('es');
  });
  it('defaults to English', () => {
    expect(detectLang('put the dishes away', { code: 'tam', probability: 0.9 })).toBe('en');
    expect(detectLang('tidy the kitchen')).toBe('en');
  });
  it('recognises "who taught you that?"', () => {
    for (const q of ['Who taught you that?', 'who taught you this', "Qui t'a appris ça ?", '¿Quién te enseñó eso?', '谁教你的？']) expect(PROVENANCE_ASK.test(q)).toBe(true);
    expect(PROVENANCE_ASK.test('tidy the kitchen')).toBe(false);
  });
});
