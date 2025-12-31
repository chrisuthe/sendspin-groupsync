import { create } from 'zustand';
import type { Player } from '../types';

interface PlayersState {
  players: Player[];
  selectedPlayerIds: string[];
  loading: boolean;
  error: string | null;
}

interface PlayersActions {
  setPlayers: (players: Player[]) => void;
  togglePlayerSelection: (playerId: string) => void;
  selectAllPlayers: () => void;
  clearSelection: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState: PlayersState = {
  players: [],
  selectedPlayerIds: [],
  loading: false,
  error: null,
};

export const usePlayersStore = create<PlayersState & PlayersActions>()((set, get) => ({
  ...initialState,

  setPlayers: (players) => set({ players, loading: false }),

  togglePlayerSelection: (playerId) => {
    const { selectedPlayerIds } = get();
    if (selectedPlayerIds.includes(playerId)) {
      set({ selectedPlayerIds: selectedPlayerIds.filter((id) => id !== playerId) });
    } else {
      set({ selectedPlayerIds: [...selectedPlayerIds, playerId] });
    }
  },

  selectAllPlayers: () => {
    const { players } = get();
    set({ selectedPlayerIds: players.map((p) => p.player_id) });
  },

  clearSelection: () => set({ selectedPlayerIds: [] }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  reset: () => set(initialState),
}));
