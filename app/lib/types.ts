export interface Track {
  id: string;
  title: string;
  author: string;
  date: string;
  filename: string;
  subDir: string;
  size: number;
  url: string;
  format?: string;
  mimeType?: string;
  bvid?: string;
  neteaseId?: string;
  source?: "local" | "bilibili" | "netease";
  duration?: string;
}

export interface ChatMessage {
  id: string;
  role: "agent" | "operator" | "system" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
}

export interface PlayerState {
  current: Track | null;
  playlist: Track[];
  index: number;
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
}

export interface AgentState {
  messages: ChatMessage[];
  loading: boolean;
  sessionId: string | null;
}
