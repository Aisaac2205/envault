import { createContext, useContext, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AuthUser } from "../hooks/useAuth";
import { LogOut, ChevronsUpDown } from "lucide-react";
import { lazyRoutes, type RouteKey } from "@/shared/lib/lazy-routes";
import type { AppSection } from "@/shared/lib/sections";
import { cn } from "@/shared/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { useSidebar } from "./SidebarProvider";


interface SidebarContextValue {
  onNavigate?: () => void;
  collapsed?: boolean;
}

const SidebarContext = createContext<SidebarContextValue>({});

function useSidebarNavContext(): SidebarContextValue {
  return useContext(SidebarContext);
}

interface NavItemConfig {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  routeKey: RouteKey;
  end?: boolean;
}

interface SidebarRootProps {
  children: ReactNode;
  onNavigate?: () => void;
  collapsible?: "icon" | "offcanvas" | "none";
}

function SidebarRoot({ children, onNavigate, collapsible = "none" }: SidebarRootProps) {
  const sidebarState = useSidebar();
  const collapsed = collapsible === "icon" && sidebarState.state === "collapsed";

  return (
    <SidebarContext.Provider value={{ onNavigate, collapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

function SidebarHeader({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebarNavContext();

  return (
    <div
      className={cn(
        "flex h-16 items-center transition-all duration-200",
        collapsed ? "justify-center px-2" : "px-4",
      )}
    >
      {children}
    </div>
  );
}

function SidebarNav({ children }: { children: ReactNode }) {
  return <nav className="flex-1 overflow-y-auto px-1 py-2 space-y-0.5">{children}</nav>;
}

function SidebarItem({ path, label, icon: Icon, routeKey, end }: NavItemConfig) {
  const { onNavigate, collapsed } = useSidebarNavContext();

  const prefetch = () => {
    void lazyRoutes[routeKey]();
  };

  return (
    <NavLink
      to={path}
      end={end}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onClick={onNavigate}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 mx-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-all",
          "focus-visible:ring-2 focus-visible:ring-sidebar-indicator focus-visible:ring-inset focus-visible:outline-none",
          isActive
            ? "border-sidebar-indicator bg-sidebar-active text-sidebar-text shadow-xs font-semibold"
            : "text-sidebar-text/70 hover:bg-sidebar-hover hover:text-sidebar-text",
          collapsed && "justify-center mx-1 px-2",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden={collapsed ? true : undefined} />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

function SidebarUser({
  user,
  onLogout,
}: {
  user: AuthUser | null;
  onLogout: () => Promise<void>;
}) {
  const { collapsed } = useSidebarNavContext();
  const { t } = useTranslation('common');

  if (!user) return null;

  // Display only. Nothing here decides what the user may see: that comes from
  // the sections the container passes down. A role without a translation
  // (one added to the API later) is shown as it is named.
  const roleLabel = t(`role.${user.role}`, { defaultValue: user.role });

  return (
    <div className="border-t border-sidebar-border/70 p-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center rounded-lg text-xs text-sidebar-text/80 transition-colors hover:bg-sidebar-hover hover:text-sidebar-text focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-indicator cursor-pointer",
              collapsed ? "justify-center p-2" : "gap-2.5 px-2.5 py-2",
            )}
            title={collapsed ? `${user.name ?? user.email} (${roleLabel})` : undefined}
            aria-label={user.name ?? user.email}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#bfe70a] text-[11px] font-bold text-black shadow-xs ring-1 ring-black/10 dark:ring-[#bfe70a]/30 select-none">
              {user.name ? user.name.slice(0, 2).toUpperCase() : user.email.slice(0, 2).toUpperCase()}
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate font-semibold text-sidebar-text text-xs">{user.name ?? user.email}</div>
                  <div className="truncate text-[10px] text-sidebar-text/60 font-medium">{roleLabel}</div>
                </div>
                <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-text/50" aria-hidden="true" />
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side={collapsed ? "right" : "top"}
          align={collapsed ? "end" : "center"}
          sideOffset={8}
          className="w-56 p-1.5 shadow-pop border-border/80 bg-popover"
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2 border-b border-border/50 mb-1">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#bfe70a] text-[11px] font-bold text-black shadow-xs ring-1 ring-black/10 dark:ring-[#bfe70a]/30 select-none">
              {user.name ? user.name.slice(0, 2).toUpperCase() : user.email.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-popover-foreground text-xs">{user.name ?? user.email}</div>
              <div className="truncate text-[10px] text-muted-foreground font-medium">{user.email}</div>
            </div>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 cursor-pointer"
            onClick={() => void onLogout()}
          >
            <LogOut className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t('action.logout')}</span>
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function SidebarContent({
  user,
  sections,
  onLogout,
}: {
  user: AuthUser | null;
  /** The sections to offer, already filtered by the server's permissions. */
  sections: readonly AppSection[];
  onLogout: () => Promise<void>;
}) {
  const { t } = useTranslation('common')
  const visibleItems: NavItemConfig[] = sections.map(
    ({ path, icon, routeKey, end, labelKey }) => ({
      path,
      icon,
      routeKey,
      end,
      label: t(labelKey),
    }),
  );

  return (
    <>
      <SidebarHeader>
        <img
          src="/logo.png"
          alt="EnVault Management"
          className="h-10 w-auto max-w-[40px] object-contain invert dark:invert-0 transition-[filter] duration-200"
        />
      </SidebarHeader>

      <SidebarNav>
        {visibleItems.map((item) => (
          <SidebarItem key={item.path} {...item} />
        ))}
      </SidebarNav>

      <SidebarUser user={user} onLogout={onLogout} />
    </>
  );
}


interface SidebarProps {
  user: AuthUser | null;
  sections: readonly AppSection[];
  onLogout: () => Promise<void>;
  collapsible?: "icon" | "offcanvas" | "none";
}

export function Sidebar({ user, sections, onLogout, collapsible = "none" }: SidebarProps) {
  const { state } = useSidebar();
  const isCollapsed = collapsible === "icon" && state === "collapsed";

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-30 hidden h-screen flex-col bg-sidebar font-medium transition-[width] duration-200 ease-out md:flex",
        isCollapsed ? "w-[56px]" : "w-[216px]",
      )}
    >
      <SidebarRoot collapsible={collapsible}>
        <SidebarContent user={user} sections={sections} onLogout={onLogout} />
      </SidebarRoot>
    </aside>
  );
}


export { SidebarRoot, SidebarHeader, SidebarNav, SidebarItem, SidebarUser };
