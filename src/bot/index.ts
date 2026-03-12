import { Bot, webhookCallback } from 'grammy';
import { CustomContext, EnvBindings } from './context';
import { getDb } from '../db/client';
import { authMiddleware } from './middlewares/auth';
import { users, images, adminSessions } from '../db/schema';
import { nanoid } from 'nanoid';
import { v4 as uuidv4 } from 'uuid'; // we need a uuid library, or just use nanoid again for simplicity or crypto.randomUUID()
import { eq } from 'drizzle-orm';

export function createBot(env: EnvBindings) {
  const bot = new Bot<CustomContext>(env.BOT_TOKEN);

  // Expose env and db to context
  bot.use(async (ctx, next) => {
    ctx.env = env;
    ctx.db = getDb(env.DB);
    await next();
  });

  // Attach strictly Auth Middleware
  bot.use(authMiddleware);

  // Command handlers
  bot.command('start', async (ctx) => {
    await ctx.reply(`👋 Welcome to Telegram Images Manager!\nYou are logged in as an authorized user.\n\nType /upload or simply send me a photo to get started!`);
  });

  bot.command('upload', async (ctx) => {
    await ctx.reply('📸 Please send me the image you want to upload (you can send multiple too!).');
  });

  bot.command('admin', async (ctx) => {
    const token = crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2 hours

    try {
      await ctx.db.insert(adminSessions).values({
        token,
        user_id: String(ctx.from?.id),
        expires_at: expiresAt,
      });

      const roleText = ctx.isAdmin ? 'Admin' : 'Personal';
      const adminBase = (env.ADMIN_URL || env.BASE_URL).replace(/\/$/, ''); // Remove trailing slash if any
      await ctx.reply(`🛡 **${roleText} Dashboard Access**\n\nLogin Token (valid for 2 hours):\n\n🔐 \`${adminBase}/admin/login?token=${token}\``, { parse_mode: 'Markdown' });
    } catch (e) {
      await ctx.reply('❌ Failed to generate access token.');
    }
  });

  // Admin Commands (setadmin / deladmin)
  bot.command('setadmin', async (ctx) => {
    if (!ctx.isAdmin) return ctx.reply('⛔️ Admin only.');
    // implementation
    const args = ctx.match.split(' ');
    if (args.length < 1) return ctx.reply('Usage: /setadmin <tg_id>');
    const tg_id = args[0];
    await ctx.db.update(users).set({ is_admin: true }).where(eq(users.tg_id, tg_id));
    await ctx.reply(`✅ Added user ${tg_id} as an admin.`);
  });

  bot.command('deladmin', async (ctx) => {
    if (!ctx.isAdmin) return ctx.reply('⛔️ Admin only.');
    const args = ctx.match.split(' ');
    if (args.length < 1) return ctx.reply('Usage: /deladmin <tg_id>');
    const tg_id = args[0];
    await ctx.db.update(users).set({ is_admin: false }).where(eq(users.tg_id, tg_id));
    await ctx.reply(`✅ Removed user ${tg_id} from admins.`);
  });

  // Handle Photo Payload
  // Use `message:photo` to capture strictly images
  bot.on('message:photo', async (ctx) => {
    const photo = ctx.message.photo;
    // get best quality photo
    const bestPhoto = photo[photo.length - 1];

    try {
      // 1. Send it to private channel
      // We use `copyMessage` to easily clone it to avoid sending the file payload from our worker memory again
      const msg = await ctx.api.copyMessage(env.CHANNEL_ID, ctx.chat.id, ctx.message.message_id);

      // 2. Save info to DB
      const id = nanoid(8); // e.g. "aB329Zx1"
      
      await ctx.db.insert(images).values({
        id,
        tg_file_id: bestPhoto.file_id,
        channel_msg_id: msg.message_id,
        uploader_id: String(ctx.from.id),
        is_public: true,
        created_at: new Date()
      });

      // 3. Return a clean link
      const baseUrl = env.BASE_URL.replace(/\/$/, '');
      await ctx.reply(`✅ **Successfully Uploaded!**\n\n🔗 Image Link:\n\`${baseUrl}/img/${id}.jpg\``, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.error(err);
      await ctx.reply(`❌ Failed to upload: ${err.message}`);
    }
  });

  // Handle document (uncompressed image)
  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith('image/')) {
      return ctx.reply('⛔️ Only image documents are allowed.');
    }

    try {
      const msg = await ctx.api.copyMessage(env.CHANNEL_ID, ctx.chat.id, ctx.message.message_id);
      const id = nanoid(8);
      
      await ctx.db.insert(images).values({
        id,
        tg_file_id: doc.file_id,
        channel_msg_id: msg.message_id,
        uploader_id: String(ctx.from.id),
        is_public: true,
        created_at: new Date()
      });

      const baseUrl = env.BASE_URL.replace(/\/$/, '');
      await ctx.reply(`✅ **Successfully Uploaded!**\n\n🔗 Image Link:\n\`${baseUrl}/img/${id}.jpg\``, { parse_mode: 'Markdown' });
    } catch (err: any) {
      await ctx.reply(`❌ Failed to upload document.`);
    }
  });

  return bot;
}
