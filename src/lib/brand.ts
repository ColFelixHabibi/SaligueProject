'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

// The About texts of Saligue and INDECIANA, set by admins (server: /api/brand). Saligue is made by INDECIANA.
// The same defaults as the server, so a page never waits on them or shows them wrong while offline.
export type Brand = {
  indeciana: { kicker: string; badge: string; about: string };
  saligue: { tagline: string; about: string };
};

export const BRAND_DEFAULTS: Brand = {
  indeciana: {
    kicker: 'The house that made Saligue',
    badge: 'Official house collection',
    about: 'INDECIANA created Saligue. This is its own collection, which you can try on with AI before you buy.',
  },
  saligue: {
    tagline: 'Saligue by INDECIANA',
    about: 'Saligue is a fashion marketplace made by INDECIANA. Shop from local shops and creators, see clothes on your own photo with AI before you buy, learn from lessons and lives, and earn by selling, teaching and sharing.',
  },
};

export function useBrand() {
  const [brand, setBrand] = useState<Brand>(BRAND_DEFAULTS);
  useEffect(() => {
    api<Brand>('/brand').then(setBrand).catch(() => {});
  }, []);
  return [brand, setBrand] as const;
}
