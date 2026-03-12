import { NextFunction } from 'grammy';
import { CustomContext } from '../context';
import { users } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';

export async function authMiddleware(ctx: CustomContext, next: NextFunction) {
  // If no from/user info, skip (e.g. channel post)
  if (!ctx.from) {
    return next();
  }

  const tg_id = String(ctx.from.id);
  const nickname = ctx.from.username || ctx.from.first_name || 'Unknown';

  // Check if DB is completely empty (first user setup)
  const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)` }).from(users);

  let user = await ctx.db.select().from(users).where(eq(users.tg_id, tg_id)).get();

  if (!user) {
    if (count === 0) {
      // First ever user becomes active admin
      await ctx.db.insert(users).values({
        tg_id,
        nickname,
        is_admin: true,
        status: 'active',
        created_at: new Date(),
      });
      user = { tg_id, nickname, is_admin: true, status: 'active', created_at: new Date() };
    } else {
      // Not first user
      if (ctx.env.ACCESS_MODE === 'single') {
        return ctx.reply('⛔️ Access Denied. Bot is running in SINGLE user mode.');
      }

      // Multi-mode: insert as pending or active
      const nextStatus = ctx.env.REQUIRE_APPROVAL === 'true' ? 'pending' : 'active';
      await ctx.db.insert(users).values({
        tg_id,
        nickname,
        is_admin: false,
        status: nextStatus,
        created_at: new Date(),
      });
      user = { tg_id, nickname, is_admin: false, status: nextStatus, created_at: new Date() };

      if (nextStatus === 'pending') {
        return ctx.reply('⏳ Your request has been sent! Please wait for an admin to approve you.');
      } else {
        await ctx.reply('✅ Welcome! Your account has been automatically approved.');
      }
    }
  }

  // At this point, `user` exists. Check status
  if (user.status === 'banned') {
    // Silently drop banned user
    return;
  }

  if (user.status === 'pending') {
    return ctx.reply('⏳ Your account is pending admin approval. You cannot use the bot yet.');
  }

  // active
  ctx.isAdmin = user.is_admin;
  ctx.userStatus = user.status;

  await next();
}
