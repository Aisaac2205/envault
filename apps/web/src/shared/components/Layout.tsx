import { useState, type ReactNode } from "react";
import { Sidebar, SidebarContent, SidebarRoot } from "./Sidebar";
import { SidebarProvider, useSidebar } from "./SidebarProvider";
import { Topbar } from "./Topbar";
import type { AuthUser } from "../hooks/useAuth";
import type { AppSection } from "../lib/sections";
import { Sheet, SheetContent } from "../ui/sheet";
import { PanelLeftOpen } from "lucide-react";
import { Toaster } from "sonner";
import { cn } from "@/shared/lib/cn";

interface LayoutProps {
  children: ReactNode;
  user: AuthUser | null;
  /** The sidebar sections to offer, already filtered by the server's permissions. */
  sections: readonly AppSection[];
  onLogout: () => Promise<void>;
}

/**
 * Layout root. Wraps the entire shell in `<SidebarProvider>` so both the
 * desktop sidebar and mobile sheet can access collapse state via context.
 *
 * Actual hook consumption happens in `<LayoutInner>` — a child component
 * rendered inside the provider boundary.
 */
export function Layout({ children, user, sections, onLogout }: LayoutProps) {
  return (
    <SidebarProvider>
      <LayoutInner user={user} sections={sections} onLogout={onLogout}>{children}</LayoutInner>
    </SidebarProvider>
  );
}

function LayoutInner({ children, user, sections, onLogout }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeMobileSidebar = () => setSidebarOpen(false);
  const { state } = useSidebar();
  const sidebarCollapsed = state === "collapsed";

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-sidebar">
      {/* Desktop sidebar — icon-rail collapsible */}
      <Sidebar user={user} sections={sections} onLogout={onLogout} collapsible="icon" />

      {/* Mobile sidebar (Sheet drawer) — NOT affected by collapse state */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[216px] bg-sidebar p-0 border-r-0"
        >
          <SidebarRoot onNavigate={closeMobileSidebar}>
            <SidebarContent user={user} sections={sections} onLogout={onLogout} />
          </SidebarRoot>
        </SheetContent>
      </Sheet>

      {/* Mobile header */}
      <header className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center border-b border-border bg-bg px-4 md:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-text/70 transition-colors hover:bg-sidebar-hover hover:text-sidebar-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-indicator"
          aria-label="Open menu"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </header>

      {/* Main content area */}
      <div
        className={cn(
          "flex min-h-screen flex-1 flex-col pt-14 md:pt-0 overflow-hidden bg-sidebar transition-[margin] duration-200 ease-out",
          sidebarCollapsed ? "md:ml-[56px]" : "md:ml-[216px]",
        )}
      >
        {/* Desktop topbar */}
        <Topbar />

        {/* Page content */}
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-auto bg-bg md:m-3 md:mt-0 md:rounded-2xl md:ring-1 md:ring-border/80 md:shadow-pop flex flex-col transition-all duration-200"
        >
          {children}
        </main>
      </div>

      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
