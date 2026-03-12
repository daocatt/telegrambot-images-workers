import { Context } from 'grammy';
import { getDb } from '../db/client';

export interface EnvBindings {
  DB: D1Database;
  BOT_TOKEN: string;
  CHANNEL_ID: string;
  ACCESS_MODE: string; // "single" | "multi"
  REQUIRE_APPROVAL: string; // "true" | "false"
  WEBHOOK_SECRET: string;
  WEBHOOK_PATH_SECRET: string;
  BASE_URL: string; // e.g. "https://my-app.workers.dev"
  ADMIN_URL?: string; // Optional custom admin panel URL
  WEBHOOK_URL?: string; // Optional custom webhook URL
  ENABLE_GALLERY?: string; // "true" | "false"
  ENABLE_PUBLIC_CHECK?: string; // "true" | "false"
}

// Extend Grammy's default Context
export interface CustomContext extends Context {
  env: EnvBindings;
  db: ReturnType<typeof getDb>;
  userStatus?: string;
  isAdmin?: boolean;
}
