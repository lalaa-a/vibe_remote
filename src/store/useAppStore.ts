import { create } from 'zustand'
import { getCredentials, type MachineCredentials } from '../api/server'

interface AppState {
  // Machine credentials — populated from MMKV on startup, then kept in sync
  credentials: MachineCredentials | null
  setCredentials: (c: MachineCredentials | null) => void

  // Which machine to filter requests by (null = all)
  selectedMachineId: string | null
  setSelectedMachineId: (id: string | null) => void

  // Toast notification
  toast: { message: string; type: 'success' | 'error' } | null
  showToast: (message: string, type?: 'success' | 'error') => void
  clearToast: () => void
}

export const useAppStore = create<AppState>((set) => ({
  // Synchronous MMKV read — no loading flash
  credentials: getCredentials(),
  setCredentials: (credentials) => set({ credentials }),

  selectedMachineId: null,
  setSelectedMachineId: (id) => set({ selectedMachineId: id }),

  toast: null,
  showToast: (message, type = 'success') => {
    set({ toast: { message, type } })
    setTimeout(() => set({ toast: null }), 3000)
  },
  clearToast: () => set({ toast: null }),
}))
