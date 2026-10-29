import type { ComponentType, SVGProps } from 'react';
import { NORSE_RELICS } from './norse';
import { POTTER_RELICS } from './potter';
import { GREEK_RELICS } from './greek';
import { GHIBLI_RELICS } from './ghibli';
import { HALLOWEEN_RELICS } from './halloween';

export type Relic = ComponentType<SVGProps<SVGSVGElement>>;
export type RelicCollection = 'norse' | 'wizarding' | 'olympus' | 'ghibli' | 'halloween';

/** The relic collections that can drift through the sky. */
export const RELIC_COLLECTIONS: Record<
  RelicCollection,
  { label: string; relics: readonly Relic[] }
> = {
  norse: { label: 'Norse artifacts', relics: NORSE_RELICS },
  wizarding: { label: 'Wizarding world', relics: POTTER_RELICS },
  olympus: { label: 'Olympus', relics: GREEK_RELICS },
  ghibli: { label: 'Ghibli world', relics: GHIBLI_RELICS },
  halloween: { label: 'Halloween', relics: HALLOWEEN_RELICS },
};

export const ALL_COLLECTIONS = Object.keys(RELIC_COLLECTIONS) as RelicCollection[];
