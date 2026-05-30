import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { ReactNode } from "react"

const STORAGE_KEY = "sentinel-llm-insights-enabled"

interface LlmInsightsContextType {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  toggle: () => void
}

const LlmInsightsContext = createContext<LlmInsightsContextType | undefined>(
  undefined
)

function readInitialValue() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "false") return false
  if (stored === "true") return true
  return false
}

export function LlmInsightsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(readInitialValue)

  const setEnabled = useCallback((nextEnabled: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(nextEnabled))
    setEnabledState(nextEnabled)
  }, [])

  const toggle = useCallback(() => {
    setEnabledState((current) => {
      const next = !current
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== STORAGE_KEY) {
        return
      }
      setEnabledState(event.newValue === "true")
    }

    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  const value = useMemo(
    () => ({ enabled, setEnabled, toggle }),
    [enabled, setEnabled, toggle]
  )

  return (
    <LlmInsightsContext.Provider value={value}>
      {children}
    </LlmInsightsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLlmInsights() {
  const context = useContext(LlmInsightsContext)
  if (context === undefined) {
    throw new Error("useLlmInsights must be used within LlmInsightsProvider")
  }
  return context
}
