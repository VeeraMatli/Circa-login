import { now, id, pair } from "./domain";
import type { MatchRow, ProfileRow } from "./types";
export interface ProfileRepository {
  find(userId: string): Promise<ProfileRow | null>;
}
export interface ConversationRepository {
  authorize(conversationId: string, userId: string): Promise<boolean>;
}
export interface MatchRepository {
  reconcile(a: string, b: string): Promise<MatchRow | null>;
}
export class D1Profiles implements ProfileRepository {
  constructor(private db: D1Database) {}
  find(userId: string) {
    return this.db
      .prepare("SELECT * FROM profiles WHERE user_id=?")
      .bind(userId)
      .first<ProfileRow>();
  }
}
export class D1Conversations implements ConversationRepository {
  constructor(private db: D1Database) {}
  async authorize(conversationId: string, userId: string) {
    const row = await this.db
      .prepare(
        `SELECT c.id FROM conversations c JOIN matches m ON m.id=c.match_id JOIN users a ON a.id=m.user_a JOIN users b ON b.id=m.user_b WHERE c.id=? AND m.status='active' AND (m.user_a=? OR m.user_b=?) AND a.status IN ('active','paused') AND b.status IN ('active','paused') AND NOT EXISTS(SELECT 1 FROM blocks WHERE (actor_id=m.user_a AND target_id=m.user_b) OR (actor_id=m.user_b AND target_id=m.user_a))`,
      )
      .bind(conversationId, userId, userId)
      .first();
    return !!row;
  }
}
export class D1Matches implements MatchRepository {
  constructor(private db: D1Database) {}
  async reconcile(a: string, b: string) {
    const [low, high] = pair(a, b),
      matchId = id();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT OR IGNORE INTO matches(id,user_a,user_b,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM swipes WHERE actor_id=? AND target_id=? AND action IN ('like','super_like')) AND EXISTS(SELECT 1 FROM swipes WHERE actor_id=? AND target_id=? AND action IN ('like','super_like')) AND (SELECT COUNT(*) FROM users WHERE id IN (?,?) AND status='active' AND age_assured_at IS NOT NULL)=2 AND NOT EXISTS(SELECT 1 FROM blocks WHERE (actor_id=? AND target_id=?) OR (actor_id=? AND target_id=?))`,
        )
        .bind(matchId, low, high, now(), a, b, b, a, a, b, a, b, b, a),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO conversations(id,match_id,created_at) SELECT id,id,created_at FROM matches WHERE user_a=? AND user_b=? AND status='active'`,
        )
        .bind(low, high),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO outbox_events(id,kind,aggregate_id,payload,created_at) SELECT id,'match',id,json_object('user_a',user_a,'user_b',user_b),created_at FROM matches WHERE user_a=? AND user_b=? AND status='active'`,
        )
        .bind(low, high),
    ]);
    return this.db
      .prepare(
        "SELECT * FROM matches WHERE user_a=? AND user_b=? AND status='active'",
      )
      .bind(low, high)
      .first<MatchRow>();
  }
}
