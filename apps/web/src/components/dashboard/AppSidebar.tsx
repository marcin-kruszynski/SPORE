import {
  MessageSquare, Network, ShieldCheck, Layers, FolderKanban, Users, Bot, Sparkles, Wrench, GitBranch, Settings, ChevronLeft, TerminalSquare,
} from "lucide-react";
import { NavLink } from "../NavLink.js";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "../ui/sidebar.js";
import { cn } from "../../lib/utils.js";

const navItems = [
  { title: "Chat", url: "/chat", icon: MessageSquare },
  { title: "Agent Cockpit", url: "/cockpit", icon: TerminalSquare },
  { title: "Mission Map", url: "/mission-map", icon: Network },
  { title: "Self-Build", url: "/self-build", icon: ShieldCheck },
  { title: "Spaces", url: "/spaces", icon: Layers },
  { title: "Projects", url: "/projects", icon: FolderKanban },
  { title: "Teams", url: "/teams", icon: Users },
  { title: "Agents", url: "/agents", icon: Bot },
  { title: "Skills", url: "/skills", icon: Sparkles },
  { title: "Tools", url: "/tools", icon: Wrench },
  { title: "Workflows", url: "/workflows", icon: GitBranch },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const isActive = (url: string) => {
    if (url === "/") return location.pathname === "/";
    return location.pathname.startsWith(url);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <div className={cn("flex h-14 items-center border-b border-sidebar-border px-4", collapsed && "justify-center px-2")}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">S</div>
            <div>
              <span className="text-sm font-semibold text-foreground">SPORE</span>
              <span className="ml-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">PROD</span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">S</div>
        )}
      </div>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild className="h-9">
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        collapsed && "justify-center px-2",
                      )}
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className={cn("h-4 w-4 shrink-0", isActive(item.url) && "text-primary")} />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">OP</div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-xs font-medium text-foreground">Operator</p>
              <p className="truncate text-[10px] text-muted-foreground">operator@spore.dev</p>
            </div>
            <button type="button" onClick={toggleSidebar} className="text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        )}
        {collapsed && (
          <button type="button" onClick={toggleSidebar} className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
            OP
          </button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
