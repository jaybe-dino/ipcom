/**
 * In-process pub/sub event bus for real-time channel updates.
 *
 * Topics are channel ids. This is intentionally simple (single-node); scaling
 * to multiple API nodes means swapping the internals for Redis pub/sub or a
 * message broker behind the same publish()/subscribe() surface.
 */
export interface ChannelEvent {
  type:
    | "post.created"
    | "post.updated"
    | "post.deleted"
    | "creation.updated"
    | "export.updated"
    | "reaction.updated"
    | "presence.updated";
  channel_id: string;
  [key: string]: unknown;
}

type Handler = (event: ChannelEvent) => void;

export class EventBus {
  private topics = new Map<string, Set<Handler>>();

  subscribe(topic: string, handler: Handler): () => void {
    let set = this.topics.get(topic);
    if (!set) {
      set = new Set();
      this.topics.set(topic, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) this.topics.delete(topic);
    };
  }

  publish(event: ChannelEvent): void {
    const set = this.topics.get(event.channel_id);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch {
        // A failing subscriber must not break the publish loop.
      }
    }
  }

  /** Number of active subscribers for a topic (useful for tests/metrics). */
  subscriberCount(topic: string): number {
    return this.topics.get(topic)?.size ?? 0;
  }
}
