/**
 * Medium model: a few interfaces referencing each other, `extends`, arrays
 * of objects, a literal union behind an alias, `Record`, `null`, and one
 * level of inline nesting. Two levels deep at most (`Project.members[].user`).
 *
 * Expected shape: an object, no warnings.
 */
export type Role = 'owner' | 'editor' | 'viewer'

interface Timestamped {
  createdAt: Date
  updatedAt: Date | null
}

export interface User {
  id: number
  name: string
  email: string
  avatarUrl?: string
}

export interface Member extends Timestamped {
  user: User
  role: Role
  active: boolean
}

export interface Project extends Timestamped {
  id: string
  name: string
  description: string | null
  visibility: 'public' | 'private'
  owner: User
  members: Member[]
  labels: Record<string, string>
  settings: {
    notifications: boolean
    defaultBranch: string
    retentionDays?: number
  }
  stars: number
  archived: boolean
}
