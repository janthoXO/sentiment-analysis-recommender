import { AppHeader } from "@/components/AppHeader"
import { Outlet } from "react-router-dom"

export default function Layout() {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <AppHeader />
      <main className="flex flex-1 flex-col bg-background px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
