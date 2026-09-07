export type RiskLevel    = 'low' | 'medium' | 'high' | 'critical'
export type ToolName     = 'Bash' | 'Write' | 'Edit' | 'MultiEdit' | 'Read' | 'bash' | 'edit' | 'write' | 'patch' | 'unknown'
export type DisplayType  = 'bash' | 'write' | 'edit' | 'multi_edit' | 'read' | 'command' | 'unknown'
export type HarnessId    = 'claude-code' | 'opencode' | 'gemini-cli' | (string & {})
export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'timeout'
  | 'cli_pending'

export interface DiffHunk {
  type:     'add' | 'remove' | 'context'
  content:  string
  line_old?: number
  line_new?: number
}

export interface FileDiff {
  type:         string
  file_path:    string
  language:     string
  stats:        { added: number; removed: number }
  hunks:        DiffHunk[]
  is_new_file?: boolean
  word_diff?:   Array<{ value: string; added: boolean; removed: boolean }>
  // multi_edit_diff only
  files?:       FileDiff[]
  file_count?:  number
  edit_count?:  number
  grand_stats?: { added: number; removed: number }
  // edit_diff only
  edits?:       FileDiff[]
}

export interface Machine {
  id:        string
  user_id:   string
  label:     string
  is_online: boolean
  last_seen: string
  created_at: string
}

export interface PendingRequest {
  id:             string
  user_id:        string
  machine_id:     string
  session_id:     string | null
  harness:        HarnessId
  tool_name:      ToolName
  display_type:   DisplayType
  summary:        string
  risk_level:     RiskLevel
  risk_reason:    string
  risk_icon:      string
  files_affected: string[]
  diff:           FileDiff | null
  command:        string | null
  file_path:      string | null
  new_content:    string | null
  old_content:    string | null
  raw_input:      Record<string, unknown> | null
  status:         RequestStatus
  response_mode:  string
  decided_at:     string | null
  decided_by:     'pc' | 'mobile' | null
  created_at:     string
  // joined
  machines?:      Pick<Machine, 'id' | 'label' | 'is_online'>
}

// QR code payload scanned from the desktop app
export interface QRPayload {
  machineId:   string
  apiKey:      string
  supabaseUrl: string
  apiUrl:      string
}

// ── Sessions / agents ─────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'idle' | 'finished'

export interface AgentSession {
  id:                string
  machine_id:        string
  machine_label:     string
  machine_is_online: boolean
  session_id:        string
  cwd:               string | null
  harness:           HarnessId
  cli_alive:         boolean        // false = the CLI window was closed
  status:            SessionStatus
  pending_count:     number
  last_activity_at:  string
  started_at:        string
}

// ── Harness state (read from /harness/:machineId) ─────────────────────────────

export interface HarnessCapabilities {
  approvals:         boolean
  narrative:         boolean
  injection:         boolean
  fileTree:          boolean
  sessionList:       boolean
  approvalMechanism: 'hook' | 'plugin' | 'mcp' | 'pty-proxy' | 'api' | 'none'
}

export interface MachineHarness {
  harness:         HarnessId
  display_name:    string
  installed:       boolean
  mobile_enabled:  boolean
  desired_enabled: boolean | null
  capabilities:    HarnessCapabilities
  version:         string | null
  updated_at:      string
}

export interface MobileCommand {
  id:           string
  session_id:   string | null
  prompt:       string
  status:       'pending' | 'delivered' | 'cancelled'
  created_at:   string
  delivered_at: string | null
}

export interface FsNode {
  name:      string
  path:      string
  type:      'file' | 'dir'
  size?:     number
  children?: FsNode[] | null
}

// ── Paginated chat feed (GET /mobile/sessions/:id/feed) ─────────────────────────
// One unified, time-ordered stream merging the three feed sources server-side.
export type FeedSource = 'terminal' | 'request' | 'prompt'

export interface FeedRow {
  source:     FeedSource
  id:         string
  created_at: string
  row:        TerminalEvent | PendingRequest | MobileCommand
}

export interface FeedPage {
  items:      FeedRow[]      // ascending by created_at within the page
  nextCursor: string | null  // pass as `before` to fetch older; null = no more
  hasMore:    boolean
}

// ── Navigation param types ─────────────────────────────────────────────────────
import type { NavigatorScreenParams } from '@react-navigation/native'
export type { NavigatorScreenParams }

export type RootStackParamList = {
  SignIn: undefined
  App:    NavigatorScreenParams<TabParamList> | undefined
}

export type TabParamList = {
  RequestsTab: NavigatorScreenParams<RequestsStackParamList> | undefined
  ChatsTab:    NavigatorScreenParams<SessionsStackParamList> | undefined
  MachinesTab: undefined
}

export interface TerminalEvent {
  id:         string
  session_id: string
  machine_id: string
  harness:    HarnessId
  event_type: 'tool_start' | 'tool_end' | 'notification' | 'stop' | 'output'
  tool_name:  string | null
  summary:    string | null
  detail:     string | null
  status:     'success' | 'error' | null
  created_at: string
}

export type RequestsStackParamList = {
  RequestsList:  undefined
  RequestDetail: { id: string }
}

export type SessionsStackParamList = {
  ChatsList:    undefined
  Chat:         {
    sessionId:       string
    machineLabel:    string
    cwd:             string | null
    machineIsOnline: boolean
    harness:         HarnessId
    status:          SessionStatus
    prefill?:        string
  }
  RequestDetail: { id: string }
  FileBrowser:   { sessionId: string; machineLabel: string; cwd: string | null }
}
