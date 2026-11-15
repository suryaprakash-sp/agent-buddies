export type BuddyStatus = 'running' | 'waiting' | 'done' | 'failed'

export type Buddy = {
  /** The agent's id (its loop's `agentId`), or `demo-<n>` for a demo buddy. */
  id: string
  /** The Agent call's short description, shown under the sprite. */
  label: string
  /** The agent type (`Explore`, `general-purpose`, ...). */
  type: string
  /** The lowest slot free when it joined; picks the sprite and its color. */
  seat: number
  /** Tool calls the agent's loop has made so far. */
  calls: number
  /** Completed and total items of the agent's own todo list, when it keeps one. */
  todoDone: number
  todoTotal: number
  /** TaskUpdate ids already counted as completed. */
  doneTaskIds: string[]
  status: BuddyStatus
  /** Clock ms when it finished; null while it runs. */
  endedAt: number | null
  isDemo: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-buddies': {
      buddies: Buddy[]
      isMuted: boolean
    }
  }
}
