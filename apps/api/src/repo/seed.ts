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

  const gd = gdSample(now);

  return {
    users: [
      { user: owner, email: "owner@remixhub.dev" },
      { user: creator, email: "minji@remixhub.dev" },
      ...gd.users,
    ],
    ips: [ip, ...gd.ips],
    spaces: [space, ...gd.spaces],
    channels: [...channels, ...gd.channels],
    creations: [creation, ...gd.creations],
    posts: [post, ...gd.posts],
    memberships: [
      { space_id: space.space_id, user_id: owner.user_id, joined_at: now },
      { space_id: space.space_id, user_id: creator.user_id, joined_at: now },
      ...gd.memberships,
    ],
  };
}

/**
 * A second, richer sample space themed around G-DRAGON as an *official* licensed
 * IP — exactly the rights-managed artist community this platform is built for.
 * Content is concept/mood examples (fashion, stage, daisy motif) across every
 * channel type, plus a remix child to showcase the lineage viewer.
 */
function gdSample(base: string): Omit<SeedData, never> {
  // Stagger timestamps so the demo feed has a natural order.
  const at = (sec: number) => new Date(new Date(base).getTime() + sec * 1000).toISOString();

  const studio: User = {
    user_id: "user_gd_studio",
    role: "OWNER",
    kyc_status: "verified",
    age_verified: true,
    display_name: "지드래곤 스튜디오 (오피셜)",
    payout_account: "acct_gd_studio",
  };
  const jiyong: User = {
    user_id: "user_daisyfan",
    role: "CREATOR",
    kyc_status: "verified",
    age_verified: true,
    display_name: "데이지플로리스트",
    payout_account: "acct_daisyfan",
  };
  const bibi: User = {
    user_id: "user_peace9",
    role: "CREATOR",
    kyc_status: "verified",
    age_verified: true,
    display_name: "삐삐",
    payout_account: "acct_peace9",
  };

  const ip: IP = {
    ip_id: "ip_gd",
    owner_id: studio.user_id,
    name: "G-DRAGON (오피셜)",
    verification: "official",
    policy: defaultConsentPolicy({
      allowed_actions: { image: true, video_recast: true, music: true, characterize: true },
    }),
  };

  const space: Space = {
    space_id: "space_gd",
    ip_id: ip.ip_id,
    name: "G-DRAGON — 콘셉트 아틀리에",
    member_count: 348_200,
    online_count: 5_120,
  };

  const S = space.space_id;
  const channels: Channel[] = [
    { channel_id: "ch_gd_notice", space_id: S, name: "공지", type: "community" },
    { channel_id: "ch_gd_fashion", space_id: S, name: "패션-화보", type: "creation", topic: "image" },
    { channel_id: "ch_gd_stage", space_id: S, name: "무대-비주얼", type: "creation", topic: "video_recast" },
    { channel_id: "ch_gd_music", space_id: S, name: "신곡-무드보드", type: "creation", topic: "music" },
    { channel_id: "ch_gd_daisy", space_id: S, name: "데이지-아트", type: "creation", topic: "image" },
    { channel_id: "ch_gd_chat", space_id: S, name: "자유수다", type: "community" },
    { channel_id: "ch_gd_templates", space_id: S, name: "프롬프트-템플릿", type: "market" },
    { channel_id: "ch_gd_export", space_id: S, name: "외부-반출-신청", type: "market" },
  ];

  const mkCreation = (
    id: string,
    creatorId: string,
    action: Creation["action"],
    prompt: string,
    createdAt: string,
    extra: Partial<Creation> = {},
  ): Creation => ({
    creation_id: id,
    ip_id: ip.ip_id,
    creator_id: creatorId,
    plugin_id: action === "music" ? "music.default" : action === "video_recast" ? "video.default" : "image.default",
    action,
    source_assets: [],
    output_asset: `asset://${id}/output`,
    moderation: { passed: true, scores: {}, flagged: [] },
    provenance: {
      source_assets: [],
      model_info: { plugin_id: "stub.local", model: "sample" },
      prompt,
    },
    status: "shared",
    created_at: createdAt,
    ...extra,
  });

  const couture = mkCreation(
    "cr_gd_couture",
    jiyong.user_id,
    "image",
    "GD 하이패션 에디토리얼, 블랙 테일러드 수트, 스튜디오 조명, 필름 그레인",
    at(20),
  );
  const stage = mkCreation(
    "cr_gd_stage",
    bibi.user_id,
    "video_recast",
    "월드투어 오프닝 무대, 레이저 & LED 파사드, 실루엣 등장",
    at(40),
  );
  const mood = mkCreation(
    "cr_gd_mood",
    jiyong.user_id,
    "music",
    "신곡 무드보드 — 미니멀 트랩 비트, 로파이 신스, 90bpm",
    at(60),
  );
  const daisy = mkCreation(
    "cr_gd_daisy",
    bibi.user_id,
    "image",
    "데이지 모티프 팝아트, 화이트 페탈 & 옐로 코어, 그래피티 텍스처",
    at(80),
  );
  // Remix child of the daisy art → demonstrates the lineage (계보) viewer.
  const daisyV2 = mkCreation(
    "cr_gd_daisy_v2",
    jiyong.user_id,
    "image",
    "데이지 모티프 리믹스 — 홀로그램 크롬 버전, 네온 배경",
    at(100),
    { parent_creation_id: daisy.creation_id, status: "generated" },
  );

  const post = (id: string, channelId: string, authorId: string, text: string, createdAt: string, creationId?: string): Post => ({
    post_id: id,
    channel_id: channelId,
    author_id: authorId,
    text,
    creation_id: creationId ?? null,
    created_at: createdAt,
  });

  const posts: Post[] = [
    post(
      "post_gd_notice",
      "ch_gd_notice",
      studio.user_id,
      "🎨 G-DRAGON 콘셉트 아틀리에에 오신 걸 환영합니다. 모든 창작물은 공식 IP 라이선스 정책(이미지·영상·음악·캐릭터 허용) 안에서 자유롭게 만들고 공유할 수 있어요. 외부 반출·상업적 사용은 '외부-반출-신청'에서 승인 후 라이선스가 발급됩니다. 데이지 🌼",
      at(5),
    ),
    post("post_gd_fashion", "ch_gd_fashion", jiyong.user_id, "블랙 테일러드 수트 화보 컨셉으로 뽑아봤어요. 필름 그레인 감성 🖤", at(21), couture.creation_id),
    post("post_gd_stage", "ch_gd_stage", bibi.user_id, "월드투어 오프닝 무대 비주얼 시안입니다. 레이저 연출 미쳤음 🔥", at(41), stage.creation_id),
    post("post_gd_music", "ch_gd_music", jiyong.user_id, "신곡 무드보드 — 미니멀 트랩 90bpm. 훅 라인 상상하면서 만들었어요 🎧", at(61), mood.creation_id),
    post("post_gd_daisy", "ch_gd_daisy", bibi.user_id, "GD 하면 데이지죠 🌼 팝아트 버전으로!", at(81), daisy.creation_id),
    post("post_gd_daisy_v2", "ch_gd_daisy", jiyong.user_id, "위 데이지 작품 리믹스 — 홀로그램 크롬으로 바꿔봤어요. (원본 계보 🌿 확인해보세요)", at(101), daisyV2.creation_id),
    post("post_gd_chat_1", "ch_gd_chat", bibi.user_id, "이번 컴백 콘셉트 뭘까요? 저는 데이지 리부트에 한 표 🌼", at(120)),
    post("post_gd_chat_2", "ch_gd_chat", jiyong.user_id, "@삐삐 ㅋㅋ 저도요. 무대 비주얼 채널에 시안 올려놨어요 보러오세요", at(130)),
  ];

  const memberships: Membership[] = [
    { space_id: S, user_id: studio.user_id, joined_at: base },
    { space_id: S, user_id: jiyong.user_id, joined_at: base },
    { space_id: S, user_id: bibi.user_id, joined_at: base },
    // Existing demo accounts also join so both logins can browse the room.
    { space_id: S, user_id: "user_owner_g", joined_at: base },
    { space_id: S, user_id: "user_minji", joined_at: base },
  ];

  return {
    users: [
      { user: studio, email: "gd@remixhub.dev" },
      { user: jiyong, email: "daisy@remixhub.dev" },
      { user: bibi, email: "peace9@remixhub.dev" },
    ],
    ips: [ip],
    spaces: [space],
    channels,
    creations: [couture, stage, mood, daisy, daisyV2],
    posts,
    memberships,
  };
}
