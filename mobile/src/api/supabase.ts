import { createClient } from '@supabase/supabase-js'
import { createMMKV } from 'react-native-mmkv'
import Config from 'react-native-config'

const storage = createMMKV({ id: 'supabase-auth' })

// MMKV is synchronous and 30x faster than AsyncStorage
// Critical for auth token reads at app startup
const MMKVAdapter = {
  getItem:    (key: string): string | null =>
    storage.getString(key) ?? null,
  setItem:    (key: string, value: string): void =>
    storage.set(key, value),
  removeItem: (key: string): void => {
    storage.remove(key)
  },
}

export const supabase = createClient(
  Config.SUPABASE_URL!,
  Config.SUPABASE_ANON_KEY!,
  {
    auth: {
      storage:            MMKVAdapter,
      autoRefreshToken:   true,
      persistSession:     true,
      detectSessionInUrl: false,   // must be false for React Native
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  }
)
