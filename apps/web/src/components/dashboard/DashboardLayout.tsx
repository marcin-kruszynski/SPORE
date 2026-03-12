import type { ReactNode } from "react";

import { SidebarProvider } from "../ui/sidebar.js";
import { AppSidebar } from "./AppSidebar.js";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </SidebarProvider>
  );
}
