import { Bot } from 'grammy';
import { CustomContext, EnvBindings } from './context';
import { getDb } from '../db/client';
import { authMiddleware } from './middlewares/auth';
import { users, images, adminSessions } from '../db/schema';
import { nanoid } from 'nanoid';
import { eq, sql } from 'drizzle-orm';

// Industrial Security: Sanitize user input to prevent XSS, Script Injection and Markdown breaking
function sanitizeCaption(text: string | undefined): string {
  if (!text) return '';
  return text
    .trim()
    .slice(0, 200) // Limit length to prevent DoS or UI breaking
    .replace(/[<>&"']/g, '') // Basic HTML escaping/removal for XSS prevention
    .replace(/[\[\]\(\)\*\_`~]/g, ''); // Remove Markdown special chars to prevent injection in tags
}

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
    await ctx.reply(`👋 Welcome to Telegram Images Manager!\nYou are logged in as an authorized user.\n\nType /upload or simply send me a photo to get started!\nType /help for more info.`);
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(`🚀 **Telegram Images Manager**\n\nA simple and powerful serverless image hosting solution powered by Cloudflare Workers and D1.\n\n🔗 **GitHub Repository:**\nhttps://github.com/daocatt/telegrambot-images-workers`, { parse_mode: 'Markdown' });
  });

  bot.command('me', async (ctx) => {
    const tg_id = String(ctx.from?.id);
    try {
      // Fetch user details
      const user = await ctx.db.select().from(users).where(eq(users.tg_id, tg_id)).get();
      if (!user) return ctx.reply('❌ User info not found.');

      // Count uploaded images
      const [{ count }] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(images)
        .where(eq(images.uploader_id, tg_id));

      const statsMsg = [
        `👤 **User Profile**\n`,
        `🆔 **ID:** \`${user.tg_id}\``,
        `📛 **Nickname:** ${user.nickname || 'N/A'}`,
        `📅 **Joined at:** ${user.created_at.toLocaleString()}`,
        `📸 **Total Uploads:** ${count} images`,
        `🛡 **Role:** ${user.is_admin ? 'Admin' : 'Member'}`
      ].join('\n');

      await ctx.reply(statsMsg, { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply('❌ Failed to fetch your info.');
    }
  });

  bot.command('upload', async (ctx) => {
    await ctx.reply('📸 Please send me the image you want to upload (you can send multiple too!).');
  });

  bot.command('dashboard', async (ctx) => {
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
      const loginUrl = `${adminBase}/admin/login?token=${token}`;
      
      await ctx.reply(`🛡 **${roleText} Dashboard Access**\n\nYour management link is ready. Please click the button below to log in. This link will expire in 2 hours for security.\n\n🔗 [Click here to Login](${loginUrl})`, { parse_mode: 'Markdown' });
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
      const msg = await ctx.api.copyMessage(env.CHANNEL_ID, ctx.chat.id, ctx.message.message_id);

      // 2. Save info to DB
      const id = nanoid(8);
      const rawCaption = ctx.message.caption;
      const cleanCaption = sanitizeCaption(rawCaption);
      
      await ctx.db.insert(images).values({
        id,
        tg_file_id: bestPhoto.file_id,
        channel_msg_id: msg.message_id,
        uploader_id: String(ctx.from.id),
        is_public: true,
        caption: cleanCaption,
        created_at: new Date()
      });

      // 3. Return a clean link
      const baseUrl = env.BASE_URL.replace(/\/$/, '');
      const fullUrl = `${baseUrl}/img/${id}.jpg`;
      const markdownLink = `![${cleanCaption || 'image'}](${fullUrl})`;
      
      await ctx.reply(`✅ **Successfully Uploaded!**\n\n🔗 **Direct URL:**\n\`${fullUrl}\`\n\n📝 **Markdown Code:**\n\`${markdownLink}\``, { 
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true }
      });
      
      console.log(`[INFO] Image uploaded: id=${id}, uploader=${ctx.from.id}, has_caption=${!!cleanCaption}`);
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
      const rawCaption = ctx.message.caption;
      const cleanCaption = sanitizeCaption(rawCaption);
      
      await ctx.db.insert(images).values({
        id,
        tg_file_id: doc.file_id,
        channel_msg_id: msg.message_id,
        uploader_id: String(ctx.from.id),
        is_public: true,
        caption: cleanCaption,
        created_at: new Date()
      });

      const baseUrl = env.BASE_URL.replace(/\/$/, '');
      const fullUrl = `${baseUrl}/img/${id}.jpg`;
      const markdownLink = `![${cleanCaption || 'image'}](${fullUrl})`;

      await ctx.reply(`✅ **Successfully Uploaded!**\n\n🔗 **Direct URL:**\n\`${fullUrl}\`\n\n📝 **Markdown Code:**\n\`${markdownLink}\``, { 
        parse_mode: 'Markdown', 
        link_preview_options: { is_disabled: true }
      });
      
      console.log(`[INFO] Document uploaded as image: id=${id}, uploader=${ctx.from.id}`);
    } catch (err: any) {
      await ctx.reply(`❌ Failed to upload document.`);
    }
  });

  return bot;
}
