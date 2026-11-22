import type { Profile, Post, Spot, Trip, Comment, Message, FriendRequest } from '@/domain/models'
export const me: Profile = {
  id: '11111111-1111-4111-8111-111111111111',
  nickname: '钓友100001',
  handle: 'DY10001',
  city: '苏州',
  method: '台钓',
  bio: '慢一点，等一口好鱼。'
}
export const chen: Profile = {
  id: '22222222-2222-4222-8222-222222222222',
  nickname: '老陈的野钓日记',
  handle: 'DY10002',
  city: '苏州',
  method: '台钓',
  bio: '二十年野钓，把每次出钓都认真记下来。'
}
export const lin: Profile = {
  id: '33333333-3333-4333-8333-333333333333',
  nickname: '阿林不空军',
  handle: 'DY10003',
  city: '杭州',
  method: '路亚',
  bio: '轻装出发，快乐收竿。'
}
const stamp = '2026-11-19T06:42:00+08:00'
const base = {
  created_at: stamp,
  status: 'published' as const,
  audience: 'public' as const,
  occurred_on: '2026-11-19',
  liked: false,
  saved: false,
  media: [],
  comment_count: 0
}
export function seed() {
  return {
    profiles: [me, chen, lin],
    posts: [
      {
        ...base,
        id: 'a1111111-1111-4111-8111-111111111111',
        author: chen,
        kind: 'catch',
        title: '秋天的鲫鱼，藏在这片芦苇边',
        body: '天刚亮就到了水边。没有急着打重窝，先沿着草边试了几竿。口很轻，浮漂慢慢顶起的那一下，整个人都安静了。\n\n今天的体会：找有草、有缓流的位置，比频繁换饵更重要。小鱼已放流，垃圾也一起带走。',
        species: '鲫鱼',
        method: '台钓',
        bait: '蚯蚓',
        weight_kg: 0.7,
        location_label: '苏州 · 大致水域',
        like_count: 28,
        comment_count: 1
      },
      {
        ...base,
        id: 'a2222222-2222-4222-8222-222222222222',
        author: lin,
        kind: 'experience',
        title: '第一次玩路亚，先把这三件事做好',
        body: '不必着急买很多饵。先练好抛投，观察岸边结构，再尝试不同回收速度。钩尖永远别朝着同行的人；挂底时也不要对着自己猛拉。',
        species: '鲈鱼',
        method: '路亚',
        bait: '软虫',
        weight_kg: null,
        location_label: '不分享位置',
        like_count: 16
      }
    ] as Post[],
    spots: [
      {
        id: 'b1111111-1111-4111-8111-111111111111',
        author: chen,
        name: '芦苇湾 · 示例水域',
        city: '苏州',
        water_type: '自然水域',
        species: '鲫鱼、白条',
        description: '岸边有缓坡，适合清晨观察鱼情。这是一条虚构的体验记录，请勿据此出行。',
        fee_note: '示例，费用未核实',
        access_note: '',
        observed_on: '2026-11-18',
        audience: 'public',
        precision: 'area',
        latitude: 31.28,
        longitude: 120.52,
        saved: false,
        created_at: stamp
      },
      {
        id: 'b2222222-2222-4222-8222-222222222222',
        author: lin,
        name: '青石岸 · 示例钓位',
        city: '杭州',
        water_type: '水库',
        species: '鲈鱼、翘嘴',
        description: '分享钓法和水域观察，不公开具体落脚点。示例记录，不是实际开放钓场。',
        fee_note: '以现场公告为准',
        access_note: '',
        observed_on: '2026-11-17',
        audience: 'public',
        precision: 'hidden',
        latitude: null,
        longitude: null,
        saved: false,
        created_at: stamp
      }
    ] as Spot[],
    trips: [] as (Trip & { owner_id: string })[],
    comments: [
      {
        id: 'c1111111-1111-4111-8111-111111111111',
        post_id: 'a1111111-1111-4111-8111-111111111111',
        author: lin,
        body: '轻口时耐心一点，确实比频繁提竿有效。',
        created_at: stamp
      }
    ] as Comment[],
    messages: [
      {
        id: 'd1111111-1111-4111-8111-111111111111',
        conversation_id: 'e1111111-1111-4111-8111-111111111111',
        sender_id: chen.id,
        client_id: 'd1111111-1111-4111-8111-111111111111',
        sequence: 1,
        body: '这周准备去水边走走？可以先交流一下钓法。',
        created_at: stamp
      }
    ] as Message[],
    conversations: [
      {
        id: 'e1111111-1111-4111-8111-111111111111',
        members: [me.id, chen.id],
        read: {} as Record<string, number>
      }
    ],
    friendships: [[me.id, chen.id]],
    requests: [] as FriendRequest[],
    follows: [] as string[],
    blocks: [] as string[],
    likes: [] as string[],
    bookmarks: [] as string[],
    spotBookmarks: [] as string[],
    reports: [] as unknown[],
    authorReceipts: {} as Record<
      string,
      { signature: string; result: { id: string; revision: number } }
    >,
    contentUpdates: {} as Record<
      string,
      {
        owner: string
        fields: Partial<Post & Spot>
        status: 'pending' | 'rejected'
        reason: string
        submitted_at: string
      }
    >,
    draftPhotos: [] as { owner: string; asset: import('@/domain/models').Media }[],
    waterReports: [] as (import('@/domain/water-report').WaterReport & {
      owner_id: string
      signature: string
    })[],
    deletedWaterReports: [] as string[],
    deletedWaterReportOwners: {} as Record<string, string>,
    waterReportReceipts: {} as Record<string, { report_id: string; signature: string }>,
    deletedTrips: [] as string[]
  }
}
export type DemoData = ReturnType<typeof seed>
