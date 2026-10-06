
'use client';

import { create } from 'zustand';

interface DashboardSearchState {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const useDashboardSearchStore = create<DashboardSearchState>((set) => ({
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
