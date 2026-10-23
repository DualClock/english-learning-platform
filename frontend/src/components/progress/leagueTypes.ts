export interface XpRule {
  code: string;
  title: string;
  unit: string;
  xp: number;
  dailyCapXp: number | null;
  note: string;
}

export interface LeagueTier {
  code: string;
  title: string;
}

export interface LeagueEntry {
  rank: number;
  name: string;
  weeklyXp: number;
  level: number;
  levelTitle: string;
  cefrLevel: string | null;
  isMe: boolean;
  zone: 'promotion' | 'demotion' | 'middle' | 'forming';
}

export interface LeagueGroup {
  league: string;
  leagueTitle: string;
  index: number;
  participants: number;
  sizeLimit: number;
  promotionSpots: number;
  demotionSpots: number;
  forming: boolean;
  promotionAvailable: boolean;
  demotionAvailable: boolean;
  promotionLeagueTitle: string | null;
  demotionLeagueTitle: string | null;
}

export interface LeagueMe {
  rank: number | null;
  weeklyXp: number;
  league: string;
  leagueTitle: string;
  level: number;
  levelTitle: string;
  participants: number;
  zone: 'promotion' | 'demotion' | 'middle' | 'forming' | null;
}

export interface LeagueHistoryItem {
  league: string;
  leagueTitle: string;
  nextLeagueTitle: string;
  rank: number;
  participants: number;
  weeklyXp: number;
  weekStart: string;
  weekEnd: string;
  outcome: 'promoted' | 'held' | 'demoted' | 'forming';
}

export interface Leaderboard {
  weekStart: string;
  weekEnd: string;
  weekEndsAt: string;
  leagues: LeagueTier[];
  group: LeagueGroup;
  me: LeagueMe;
  entries: LeagueEntry[];
  history: LeagueHistoryItem[];
  xpRules: XpRule[];
}
