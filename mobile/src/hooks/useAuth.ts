import { useAppStore } from '../store/useAppStore'
import { clearCredentials } from '../api/server'

export function useAuth() {
  const credentials    = useAppStore(s => s.credentials)
  const setCredentials = useAppStore(s => s.setCredentials)

  function signOut() {
    clearCredentials()
    setCredentials(null)
  }

  return { credentials, loading: false, signOut }
}
