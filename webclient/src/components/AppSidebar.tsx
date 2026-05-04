import { Link, useLocation } from "react-router-dom"
import { Search, Popcorn } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarTrigger,
} from "@/components/ui/sidebar"

// Menu items.
const items = [
  {
    title: "Search",
    url: "/search",
    icon: Search,
  },
  {
    title: "Watchlist",
    url: "/watchlist",
    icon: Popcorn,
  },
]

export function AppSidebar() {
  const location = useLocation()

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Sentinel Finance</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      location.pathname === item.url ||
                      (item.url === "/search" && location.pathname === "/")
                    }
                  >
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex w-full items-center justify-end p-2">
          <SidebarTrigger />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
