import { ThemeProvider } from "./context/theme-provider"
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom"
import Layout from "./components/Layout"
import SearchPage from "./pages/Search"
import WatchlistPage from "./pages/Watchlist"
import { Toaster } from "@/components/ui/sonner"

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/search" replace /> },
      { path: "search", element: <SearchPage /> },
      { path: "watchlist", element: <WatchlistPage /> },
    ],
  },
])

export function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <RouterProvider router={router} />
      <Toaster />
    </ThemeProvider>
  )
}

export default App
