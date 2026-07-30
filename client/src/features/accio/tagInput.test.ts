import { describe, expect, it } from 'vitest';
import { activeFragment, applySuggestion, committedTags, suggestFor } from './tagInput';

const KNOWN = ['later', 'recipes', 'reading', 'work'];

describe('activeFragment', () => {
  it('is the text after the last comma', () => {
    expect(activeFragment('recipes, rea')).toBe('rea');
    expect(activeFragment('recipes,')).toBe('');
    expect(activeFragment('  Work ')).toBe('work');
    expect(activeFragment('')).toBe('');
  });
});

describe('committedTags', () => {
  it('normalizes the way the server will', () => {
    expect(committedTags(' Recipes , later ,, ')).toEqual(['recipes', 'later']);
  });
});

describe('suggestFor', () => {
  it('offers everything when the field is empty — clicking in shows what exists', () => {
    expect(suggestFor('', KNOWN)).toEqual(KNOWN);
  });

  it('narrows to the fragment being typed', () => {
    expect(suggestFor('re', KNOWN)).toEqual(['recipes', 'reading']);
    expect(suggestFor('recipes, re', KNOWN)).toEqual(['reading']);
  });

  it('matches anywhere in the tag, not just the start', () => {
    expect(suggestFor('ing', KNOWN)).toEqual(['reading']);
  });

  it('drops tags the field already holds', () => {
    expect(suggestFor('recipes, ', KNOWN)).toEqual(['later', 'reading', 'work']);
  });

  it('keeps suggesting a tag while it is still being typed', () => {
    // "work" is the active fragment, not yet committed — it must stay offered
    // so the list doesn't vanish on the last keystroke before completion.
    expect(suggestFor('work', KNOWN)).toEqual(['work']);
  });

  it('offers nothing when the shelf has no tags', () => {
    expect(suggestFor('any', [])).toEqual([]);
  });
});

describe('applySuggestion', () => {
  it('completes the fragment and opens the next slot', () => {
    expect(applySuggestion('re', 'recipes')).toBe('recipes, ');
    expect(applySuggestion('later, re', 'recipes')).toBe('later, recipes, ');
    expect(applySuggestion('', 'work')).toBe('work, ');
  });

  it('leaves earlier tags untouched', () => {
    expect(applySuggestion('later,recipes,wo', 'work')).toBe('later,recipes, work, ');
  });
});
