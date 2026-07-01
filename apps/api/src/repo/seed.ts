import {
  defaultConsentPolicy,
  type Channel,
  type Creation,
  type IP,
  type Membership,
  type Post,
  type Space,
  type User,
} from "@remix-hub/core";

/** The Artist G demo dataset (matches the interactive mockup). */
export interface SeedData {
  users: { user: User; email: string }[];
  ips: IP[];
  spaces: Space[];
  channels: Channel[];
  creations: Creation[];
  posts: Post[];
  memberships: Membership[];
}

export function seedData(now: string): SeedData {
  const owner: User = {
    user_id: "user_owner_g",
    role: "OWNER",
    kyc_status: "verified",
    age_verified: true,
    display_name: "Artist G (소속사)",
    payout_account: "acct_owner_g",
  };
  const creator: User = {
    user_id: "user_minji",
    role: "CREATOR",
    kyc_status: "verified",
    age_verified: true,
    display_name: "민지",
    payout_account: "acct_minji",
  };

  const ip: IP = {
    ip_id: "ip_artist_g",
    owner_id: owner.user_id,
    name: "아티스트 G",
    verification: "official",
    policy: defaultConsentPolicy({
      allowed_actions: { image: true, video_recast: true, music: true, characterize: true },
    }),
  };

  const space: Space = {
    space_id: "space_artist_g",
    ip_id: ip.ip_id,
    name: "아티스트 G — 컨셉 랩",
    member_count: 12_480,
    online_count: 840,
  };

  const channels: Channel[] = [
    { channel_id: "ch_image_remix", space_id: space.space_id, name: "이미지-리믹스", type: "creation", topic: "image" },
    { channel_id: "ch_song_mood", space_id: space.space_id, name: "신곡-무드보드", type: "creation", topic: "music" },
    { channel_id: "ch_video_concept", space_id: space.space_id, name: "영상-컨셉", type: "creation", topic: "video_recast" },
    { channel_id: "ch_notice", space_id: space.space_id, name: "공지", type: "community" },
    { channel_id: "ch_chat", space_id: space.space_id, name: "자유수다", type: "community" },
    { channel_id: "ch_templates", space_id: space.space_id, name: "프롬프트-템플릿", type: "market" },
    { channel_id: "ch_export", space_id: space.space_id, name: "외부-반출-신청", type: "market" },
  ];

  const creation: Creation = {
    creation_id: "cr_neon_042",
    ip_id: ip.ip_id,
    creator_id: creator.user_id,
    plugin_id: "image.default",
    action: "image",
    source_assets: [],
    output_asset: "asset://cr_neon_042/output",
    moderation: { passed: true, scores: {}, flagged: [] },
    status: "shared",
    created_at: now,
  };

  const post: Post = {
    post_id: "post_1",
    channel_id: "ch_image_remix",
    author_id: creator.user_id,
    text: "아티스트 G 컨셉으로 사이버펑크 무드 이미지 만들어봤어요 🌃",
    creation_id: creation.creation_id,
    created_at: now,
  };

  return {
    users: [
      { user: owner, email: "owner@remixhub.dev" },
      { user: creator, email: "minji@remixhub.dev" },
    ],
    ips: [ip],
    spaces: [space],
    channels,
    creations: [creation],
    posts: [post],
    memberships: [
      { space_id: space.space_id, user_id: owner.user_id, joined_at: now },
      { space_id: space.space_id, user_id: creator.user_id, joined_at: now },
    ],
  };
}
