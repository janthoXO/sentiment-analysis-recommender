import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/AppSidebar"
import { Outlet } from "react-router-dom"

export default function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="flex min-h-screen w-full flex-col bg-background px-4 py-8">
        <Outlet />
      </main>
    </SidebarProvider>
  )
}
