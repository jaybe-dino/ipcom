import type { Listing, Space } from "@remix-hub/core";
import type { Repo } from "./repo/types.js";

export interface SearchResults {
  query: string;
  spaces: Space[];
  users: { user_id: string; display_name?: string; role: string }[];
  listings: Listing[];
}

/**
 * Cross-entity search (PRD discoverability): spaces, users, and marketplace
 * listings. MVP does case-insensitive substring matching over the current
 * lists; a later phase swaps in Postgres ILIKE / full-text indexes behind the
 * same interface without touching callers.
 */
export class SearchService {
  constructor(
    private readonly repo: Repo,
    private readonly limit = 10,
  ) {}

  async search(rawQuery: string): Promise<SearchResults> {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return { query: rawQuery, spaces: [], users: [], listings: [] };

    const [spaces, users, listings] = await Promise.all([
      this.repo.listSpaces(),
      this.repo.listUsers(),
      this.repo.listListings(),
    ]);

    return {
      query: rawQuery,
      spaces: spaces.filter((s) => s.name.toLowerCase().includes(q)).slice(0, this.limit),
      users: users
        .filter((u) => (u.display_name ?? u.user_id).toLowerCase().includes(q))
        .slice(0, this.limit)
        .map((u) => ({ user_id: u.user_id, display_name: u.display_name, role: u.role })),
      listings: listings
        .filter((l) => l.active && l.title.toLowerCase().includes(q))
        .slice(0, this.limit),
    };
  }
}
