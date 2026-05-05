import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

const sharedOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
} as const;

export const supabaseAdmin = createClient(
  env.supabaseUrl,
  env.supabaseServiceRoleKey,
  sharedOptions
);

export function createSupabaseUserClient(accessToken?: string) {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    ...sharedOptions,
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      : undefined
  });
}
