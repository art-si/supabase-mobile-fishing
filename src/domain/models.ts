export type Audience = 'public' | 'friends' | 'private'
export type Precision = 'exact' | 'area' | 'hidden'
export type ContentStatus = 'pending' | 'published' | 'rejected' | 'hidden' | 'deleted'
/** Author-only metadata; proposed fields are returned only by edit_content. */
export interface ContentUpdateInfo {
  status: 'pending' | 'rejected'
  reason: string
  submitted_at: string
}
export interface Profile {
  id: string
  nickname: string
  city: string
  bio: string
  method: string
  handle: string
  avatar?: Media | null
}
export interface Media {
  id: string
  path: string
  width: number
  height: number
  url?: string
  kind?: 'image' | 'video'
  duration?: number
  size?: number
}
export interface Post {
  review_revision?: number
  content_update?: ContentUpdateInfo | null
  id: string
  author: Profile
  title: string
  body: string
  kind: 'catch' | 'experience'
  species: string
  method: string
  bait: string
  additives?: string
  weight_kg: number | null
  count?: number | null
  length_cm?: number | null
  occurred_on: string
  occurred_at?: string | null
  location_label: string
  location_longitude?: number | null
  location_latitude?: number | null
  topic?: string
  audience: Audience
  status: ContentStatus
  created_at: string
  like_count: number
  comment_count: number
  liked: boolean
  saved: boolean
  media: Media[]
}
export interface Comment {
  media?: Media[]
  status?: 'published' | 'hidden'
  id: string
  post_id: string
  author: Profile
  body: string
  created_at: string
  reply_to_id?: string | null
  reply_to?: { id: string; author: Profile; body: string } | null
  /** Only local experience storage uses this; deleted rows never leave the remote projection. */
  deleted_at?: string | null
}
export interface CommentPage {
  items: Comment[]
  next: string | null
  total: number
}
export interface Spot {
  distance_m?: number
  distance_approximate?: boolean
  fishing_status?: 'allowed' | 'prohibited'
  review_revision?: number
  content_update?: ContentUpdateInfo | null
  id: string
  author: Profile
  name: string
  city: string
  location_label?: string
  water_type: string
  species: string
  description: string
  fee_note: string
  access_note: string
  observed_on: string
  audience: Audience
  precision: Precision
  latitude: number | null
  longitude: number | null
  saved: boolean
  created_at: string
  status?: ContentStatus
  media?: Media[]
}
export interface CatchRecord {
  species: string
  count: number | null
  weight_kg: number | null
}
export interface CatchDraft {
  /** Local row identity, not an independently writable server entity. */
  id: string
  species: string
  count: string
  weight: string
  weight_unit?: import('./catch-measurements').WeightUnit
}
export interface Trip {
  revision?: number
  id: string
  title: string
  body: string
  occurred_on: string
  species: string
  method: string
  bait: string
  additives?: string
  occurred_at?: string | null
  weight_kg: number | null
  count: number | null
  catch_records?: CatchRecord[]
  created_at: string
  media?: Media[]
}
export interface FriendRequest {
  id: string
  sender: Profile
  recipient: Profile
  note: string
  status: string
  created_at: string
}
export interface Conversation {
  id: string
  peer: Profile
  last_message: string
  last_at: string
  unread: number
  can_send: boolean
  /** Null/absent when peer reading activity must not be disclosed. */
  peer_read_sequence?: number | null
}
export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  client_id: string
  sequence: number
  body: string
  created_at: string
  kind?: 'text' | 'image' | 'post' | 'spot'
  media?: Media[]
  card?: { id: string; type: 'post' | 'spot'; title: string; detail: string } | null
  /** In-memory UI state only; never sent to the database. */
  localPhoto?: string
  mediaSignedAt?: number
  error?: string
  retryable?: boolean
  delivery?: 'sending' | 'failed'
}
export interface SocialSnapshot {
  notifications?: { interaction: number; system: number }
  friends: Profile[]
  requests: FriendRequest[]
  conversations: Conversation[]
}
export interface PersonDetail {
  profile: Profile
  following: boolean
  friend: boolean
  blocked: boolean
  posts: Post[]
}
export interface Page<T> {
  items: T[]
  next: string | null
}
export interface PostDraft {
  id: string
  title: string
  body: string
  kind: 'catch' | 'experience'
  species: string
  method: string
  bait: string
  additives?: string
  weight: string
  weight_unit?: import('./catch-measurements').WeightUnit
  count: string
  length?: string
  /** Private journal only. Never sent with a post or copied into a share draft. */
  catches?: CatchDraft[]
  occurred_on: string
  occurred_time?: string
  location_label: string
  location_longitude?: number | null
  location_latitude?: number | null
  topic?: string
  audience: Audience
  media: Media[]
}
export interface SpotDraft {
  fishing_status?: 'allowed' | 'prohibited'
  id: string
  name: string
  city: string
  location_label?: string
  water_type: string
  species: string
  description: string
  fee_note: string
  access_note: string
  observed_on: string
  audience: Audience
  precision: Precision
  latitude: number | null
  longitude: number | null
  media?: Media[]
}
export type Payload = Record<string, unknown>
