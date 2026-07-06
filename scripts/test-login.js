import app from '../src/index.ts';

// Mock bindings for the environment
const mockEnv = {
  DB: {
    prepare: (sql) => ({
      bind: (...args) => ({
        all: async () => ({ results: [], success: true }),
        get: async () => {
          console.log("Mock DB Get called for SQL:", sql, "with args:", args);
          // Return a mock user if query is for users email
          if (sql.includes('FROM `users`')) {
            return {
              tg_id: '999999',
              nickname: 'LocalAdmin',
              is_admin: 1,
              status: 'active',
              created_at: Date.now(),
              email: 'test@example.com',
              password_hash: 'pbkdf2_sha256$100000$dd176948c9999f7b0a99b812be515bfb$c593242af6927c8d0398529cb38c03d1eb2b044d4b983dc52c64a872a8e37307',
              email_verified: 1
            };
          }
          return null;
        },
        run: async () => ({ success: true })
      }),
      first: async () => null,
      all: async () => ({ results: [], success: true }),
      run: async () => ({ success: true })
    }),
    batch: async (statements) => [],
    exec: async (sql) => ({ count: 0, duration: 0 })
  },
  BOT_TOKEN: "mock_token",
  CHANNEL_ID: "mock_channel",
  ACCESS_MODE: "multi",
  WEBHOOK_SECRET: "mock_secret",
  WEBHOOK_PATH_SECRET: "mock_path",
  BASE_URL: "http://localhost:8787"
};

async function runTest() {
  console.log("Running local Hono test-request simulation...");
  try {
    const res = await app.request('/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'http://localhost:8787'
      },
      body: new URLSearchParams({
        email: 'test@example.com',
        password: 'password123'
      }).toString()
    }, mockEnv);

    console.log("Status:", res.status);
    console.log("Headers:", Object.fromEntries(res.headers.entries()));
    const body = await res.text();
    console.log("Body length:", body.length);
    if (res.status === 500) {
      console.log("Error Response Body:", body);
    }
  } catch (err) {
    console.error("Simulation crashed with error:", err);
  }
}

runTest();
