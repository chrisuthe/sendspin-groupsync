/**
 * Player types for Music Assistant Sendspin players
 */

export interface Player {
  player_id: string;
  name: string;
  type: string;
  available: boolean;
  powered: boolean;
  volume_level: number;
  muted: boolean;
  group_childs?: string[];
  synced_to?: string;
  can_sync_with?: string[];
}

export interface PlayerGroup {
  group_id: string;
  name: string;
  members: string[];
  leader: string;
}

export interface PlayerState {
  players: Player[];
  selectedPlayers: string[];
  loading: boolean;
  error: string | null;
}
