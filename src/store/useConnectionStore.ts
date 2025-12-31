import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ConnectionState {
  serverUrl: string;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  recentServers: string[];
}

interface ConnectionActions {
  setServerUrl: (url: string) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  addRecentServer: (url: string) => void;
  reset: () => void;
}

const initialState: ConnectionState = {
  serverUrl: '',
  connected: false,
  connecting: false,
  error: null,
  recentServers: [],
};

export const useConnectionStore = create<ConnectionState & ConnectionActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setServerUrl: (url) => set({ serverUrl: url }),

      setConnected: (connected) => set({ connected, connecting: false }),

      setConnecting: (connecting) => set({ connecting, error: null }),

      setError: (error) => set({ error, connecting: false, connected: false }),

      addRecentServer: (url) => {
        const { recentServers } = get();
        const filtered = recentServers.filter((s) => s !== url);
        set({ recentServers: [url, ...filtered].slice(0, 5) });
      },

      reset: () => set({ ...initialState, recentServers: get().recentServers }),
    }),
    {
      name: 'groupsync-connection',
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        recentServers: state.recentServers,
      }),
    }
  )
);
