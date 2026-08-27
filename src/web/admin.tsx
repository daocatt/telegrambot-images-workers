import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq } from 'drizzle-orm'
import { ContextEnv } from './types'
import authApp from './routes/auth'
import imagesApp from './routes/images'
import usersApp from './routes/users'
import groupsApp from './routes/groups'

const adminApp = new Hono<ContextEnv>()

adminApp.use('*', cors({
  origin: (origin) => origin,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

// Authentication & Session Guard Middleware
adminApp.use('*', async (c, next) => {
  const path = c.req.path
  if (
    path.endsWith('/login') || 
    path.endsWith('/login-ticket') || 
    path.endsWith('/logout') || 
    path.includes('/send-code') || 
    path.includes('/verify-code')
  ) {
    return next()
  }

  if (c.req.method === 'POST') {
    const origin = c.req.header('Origin') || c.req.header('Referer')
    if (origin) {
      const originHost = new URL(origin).hostname
      const reqHost = new URL(c.req.url).hostname
      if (originHost !== reqHost) {
        return c.text('Forbidden: CSRF check failed', 403)
      }
    }
  }

  const token = getCookie(c, 'admin_token')
  const queryToken = c.req.query('token')
  const currentToken = token || queryToken

  if (!currentToken) {
    return c.redirect('/admin/login?error=missing_token')
  }

  const db = drizzle(c.env.DB, { schema })
  const session = await db.select().from(schema.adminSessions).where(eq(schema.adminSessions.token, currentToken)).get()

  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    if (session) {
      c.executionCtx.waitUntil(db.delete(schema.adminSessions).where(eq(schema.adminSessions.token, currentToken)))
    }
    deleteCookie(c, 'admin_token')
    return c.redirect('/admin/login?error=expired')
  }

  // If logged in via URL token, set the persistent cookie
  if (queryToken && !token) {
    setCookie(c, 'admin_token', queryToken, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 2 * 60 * 60,
    })
  }

  const user = await db.select().from(schema.users).where(eq(schema.users.tg_id, session.user_id)).get()
  if (!user) {
    deleteCookie(c, 'admin_token')
    return c.redirect('/admin/login?error=user_not_found')
  }

  c.set('userId', session.user_id)
  c.set('isAdmin', Boolean(user.is_admin))

  const superAdminTgId = c.env.SUPER_ADMIN_TG_ID ? String(c.env.SUPER_ADMIN_TG_ID).trim() : ''
  const isSuperAdmin = superAdminTgId
    ? String(user.tg_id).trim() === superAdminTgId
    : Boolean(user.is_admin)
  c.set('isSuperAdmin', Boolean(isSuperAdmin))

  // Redirect to setup credentials if not completed
  if (!user.email || !user.password_hash) {
    if (!path.endsWith('/setup-credentials')) {
      return c.redirect('/admin/setup-credentials')
    }
  }

  await next()
})

// Mount Submodules
adminApp.route('/', authApp)
adminApp.route('/', imagesApp)
adminApp.route('/', usersApp)
adminApp.route('/', groupsApp)

export default adminApp
