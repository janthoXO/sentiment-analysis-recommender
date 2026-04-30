import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { ThemeProvider } from "./components/theme-provider"
import { CounterProvider } from "./context/CounterContext"
import { CounterPage } from "./pages/CounterPage"

export function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <CounterProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/counter" replace />} />
            <Route path="/counter" element={<CounterPage />} />
          </Routes>
        </BrowserRouter>
      </CounterProvider>
    </ThemeProvider>
  )
}

export default App
