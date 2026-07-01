/**
 * Tracks which users currently have at least one live WebSocket connection.
 * Ref-counted so multiple tabs/devices per user work correctly.
 */
export class PresenceTracker {
  private counts = new Map<string, number>();

  add(userId: string): void {
    this.counts.set(userId, (this.counts.get(userId) ?? 0) + 1);
  }

  /** Returns true if the user went fully offline (last connection closed). */
  remove(userId: string): boolean {
    const n = (this.counts.get(userId) ?? 0) - 1;
    if (n <= 0) {
      this.counts.delete(userId);
      return true;
    }
    this.counts.set(userId, n);
    return false;
  }

  isOnline(userId: string): boolean {
    return (this.counts.get(userId) ?? 0) > 0;
  }

  online(): string[] {
    return [...this.counts.keys()];
  }
}
