import {
  defaultConsentPolicy,
  type Channel,
  type ChannelType,
  type Space,
  type User,
} from "@remix-hub/core";
import { newId, now } from "./ids.js";
import type { Repo } from "./repo/types.js";

type Result<T> = { ok: true; value: T } | { ok: false; status: number; reason: string };

/**
 * Community service: users create spaces (each backed by an owner-controlled IP
 * with default consent), open channels, and join/leave. This turns the single
 * seeded space into a real multi-community platform.
 */
export class CommunityService {
  constructor(private readonly repo: Repo) {}

  /** Create a space + its IP + default channels, and enroll the creator. */
  async createSpace(params: { ownerId: string; name: string }): Promise<Result<Space>> {
    const name = params.name?.trim();
    if (!name) return { ok: false, status: 400, reason: "name_required" };

    const ip = {
      ip_id: newId("ip"),
      owner_id: params.ownerId,
      name,
      verification: "unverified" as const,
      policy: defaultConsentPolicy(),
    };
    await this.repo.saveIp(ip);

    const space: Space = {
      space_id: newId("space"),
      ip_id: ip.ip_id,
      name,
      member_count: 0,
      online_count: 0,
    };
    await this.repo.saveSpace(space);

    // Sensible default channels for a new community.
    const defaults: { name: string; type: ChannelType; topic?: string }[] = [
      { name: "공지", type: "community" },
      { name: "자유수다", type: "community" },
      { name: "창작", type: "creation", topic: "image" },
    ];
    for (const d of defaults) {
      await this.repo.saveChannel({
        channel_id: newId("ch"),
        space_id: space.space_id,
        name: d.name,
        type: d.type,
        topic: d.topic,
      });
    }

    await this.repo.addMember({ space_id: space.space_id, user_id: params.ownerId, joined_at: now() });
    const created = await this.repo.getSpace(space.space_id);
    return { ok: true, value: created ?? space };
  }

  async createChannel(params: {
    spaceId: string;
    userId: string;
    name: string;
    type?: ChannelType;
    topic?: string;
  }): Promise<Result<Channel>> {
    const space = await this.repo.getSpace(params.spaceId);
    if (!space) return { ok: false, status: 404, reason: "space_not_found" };
    if (!(await this.repo.isMember(params.spaceId, params.userId))) {
      return { ok: false, status: 403, reason: "not_a_member" };
    }
    const name = params.name?.trim();
    if (!name) return { ok: false, status: 400, reason: "name_required" };

    const channel: Channel = {
      channel_id: newId("ch"),
      space_id: params.spaceId,
      name,
      type: params.type ?? "community",
      topic: params.topic,
    };
    await this.repo.saveChannel(channel);
    return { ok: true, value: channel };
  }

  async join(spaceId: string, userId: string): Promise<Result<Space>> {
    const space = await this.repo.getSpace(spaceId);
    if (!space) return { ok: false, status: 404, reason: "space_not_found" };
    await this.repo.addMember({ space_id: spaceId, user_id: userId, joined_at: now() });
    return { ok: true, value: (await this.repo.getSpace(spaceId)) ?? space };
  }

  async leave(spaceId: string, userId: string): Promise<Result<{ left: true }>> {
    await this.repo.removeMember(spaceId, userId);
    return { ok: true, value: { left: true } };
  }

  async members(spaceId: string): Promise<User[]> {
    return this.repo.listMembers(spaceId);
  }

  async mySpaces(userId: string): Promise<Space[]> {
    return this.repo.listSpacesForUser(userId);
  }
}
