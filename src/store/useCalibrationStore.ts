import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CalibrationPhase, CalibrationResult, ClickDetection } from '../types';

interface CalibrationState {
  phase: CalibrationPhase;
  currentPlayerId: string | null;
  detectedClicks: ClickDetection[];
  results: Record<string, CalibrationResult>;
  error: string | null;
}

interface CalibrationActions {
  setPhase: (phase: CalibrationPhase) => void;
  setCurrentPlayer: (playerId: string | null) => void;
  addClickDetection: (detection: ClickDetection) => void;
  clearDetections: () => void;
  setResult: (playerId: string, result: CalibrationResult) => void;
  updateOffset: (playerId: string, offsetMs: number) => void;
  setError: (error: string | null) => void;
  reset: () => void;
  clearResults: () => void;
}

const initialState: CalibrationState = {
  phase: 'idle',
  currentPlayerId: null,
  detectedClicks: [],
  results: {},
  error: null,
};

export const useCalibrationStore = create<CalibrationState & CalibrationActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setPhase: (phase) => set({ phase }),

      setCurrentPlayer: (playerId) => set({ currentPlayerId: playerId }),

      addClickDetection: (detection) => {
        const { detectedClicks } = get();
        set({ detectedClicks: [...detectedClicks, detection] });
      },

      clearDetections: () => set({ detectedClicks: [] }),

      setResult: (playerId, result) => {
        const { results } = get();
        set({ results: { ...results, [playerId]: result } });
      },

      updateOffset: (playerId, offsetMs) => {
        const { results } = get();
        const existing = results[playerId];
        if (existing) {
          set({
            results: {
              ...results,
              [playerId]: { ...existing, offsetMs },
            },
          });
        }
      },

      setError: (error) => set({ error }),

      reset: () => set({ ...initialState, results: get().results }),

      clearResults: () => set({ results: {} }),
    }),
    {
      name: 'groupsync-calibration',
      partialize: (state) => ({
        results: state.results,
      }),
    }
  )
);
