import { ThemeProvider } from "./context/theme-provider"
import { Routes, Route, useLocation } from "react-router-dom"
import { BrowserRouter } from "react-router-dom"
import Layout from "./components/Layout"
import HomePage from "./pages/Home"
import SearchPage from "./pages/Search"
import WatchlistPage from "./pages/Watchlist"
import { Toaster } from "@/components/ui/sonner"
import { AuthProvider } from "./context/auth-provider"
import { WatchlistProvider } from "./context/watchlist-provider"
import { AuthModal } from "./components/AuthModal"
import StockDetailPage from "./pages/StockDetail"
import { ErrorBoundary } from "./components/ErrorBoundary"

function AppRoutes() {
  const location = useLocation()
  const backgroundLocation = location.state?.backgroundLocation

  return (
    <>
      <Routes location={backgroundLocation || location}>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="watchlist" element={<WatchlistPage />} />
          <Route path="stock/:ticker" element={<StockDetailPage />} />
        </Route>
      </Routes>

      {backgroundLocation && (
        <Routes>
          <Route path="/login" element={<AuthModal isRegister={false} />} />
          <Route path="/register" element={<AuthModal isRegister={true} />} />
        </Routes>
      )}

      {/* When accessed directly without background location */}
      {!backgroundLocation && (
        <Routes>
          <Route path="/login" element={<AuthModal isRegister={false} />} />
          <Route path="/register" element={<AuthModal isRegister={true} />} />
        </Routes>
      )}
    </>
  )
}

export function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <BrowserRouter>
        <AuthProvider>
          <WatchlistProvider>
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </WatchlistProvider>
        </AuthProvider>
      </BrowserRouter>
      <Toaster />
    </ThemeProvider>
  )
}

export default App
