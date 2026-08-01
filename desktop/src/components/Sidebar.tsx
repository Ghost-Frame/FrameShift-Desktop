"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AmbientPlayer } from "@/components/AmbientPlayer";
import type { DesktopProject } from "@/lib/tauri";

// One navigation destination rendered in the desktop sidebar.
interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

// Props used to expose and change the active project context.
interface SidebarProps {
  project: DesktopProject;
  choosingProject: boolean;
  onChooseProject: () => void;
}

// Dashboard navigation icon.
function HomeIcon() {
  return (
    <svg
      className="sidebar-link-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2 6.5L8 2l6 4.5V14H10v-3H6v3H2V6.5z" />
    </svg>
  );
}

// Installed-personas navigation icon.
function PersonasIcon() {
  return (
    <svg
      className="sidebar-link-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" />
    </svg>
  );
}

// Marketplace navigation icon.
function MarketplaceIcon() {
  return (
    <svg
      className="sidebar-link-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="1" y="7" width="14" height="8" rx="1" />
      <path d="M4 7V5a4 4 0 018 0v2" />
    </svg>
  );
}

// Publisher security navigation icon.
function PublisherIcon() {
  return (
    <svg
      className="sidebar-link-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M8 1.5l5 2v3.8c0 3.2-2.1 5.8-5 7.2-2.9-1.4-5-4-5-7.2V3.5l5-2z" />
      <circle cx="8" cy="7" r="1.5" />
      <path d="M8 8.5V11" />
    </svg>
  );
}

// Settings navigation icon.
function SettingsIcon() {
  return (
    <svg
      className="sidebar-link-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}

// Stable primary destinations displayed in navigation order.
const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: <HomeIcon /> },
  { href: "/personas", label: "Personas", icon: <PersonasIcon /> },
  { href: "/marketplace", label: "Marketplace", icon: <MarketplaceIcon /> },
  { href: "/publisher", label: "Publisher", icon: <PublisherIcon /> },
  { href: "/settings", label: "Settings", icon: <SettingsIcon /> },
];

// Renders navigation and the currently selected project at all times.
export function Sidebar({
  project,
  choosingProject,
  onChooseProject,
}: SidebarProps) {
  const pathname = usePathname();

  // Matches nested pages to their parent sidebar destination.
  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-mark" aria-hidden="true">
          <span>F</span>
        </span>
        <div>
          <div className="sidebar-logo-text">FrameShift</div>
          <div className="sidebar-logo-sub">creative crew</div>
        </div>
      </div>
      <div className="sidebar-project">
        <div className="sidebar-section-label">
          <span>Project</span>
          <span className="sidebar-project-state">Local</span>
        </div>
        <div className="sidebar-project-name" title={project.path ?? undefined}>
          {project.name ?? "Unnamed project"}
        </div>
        <div className="sidebar-project-path" title={project.path ?? undefined}>
          Personas stay scoped here
        </div>
        <button
          className="sidebar-project-switch"
          type="button"
          onClick={onChooseProject}
          disabled={choosingProject}
        >
          {choosingProject ? "Opening..." : "Change project"}
        </button>
      </div>
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Your workspace</div>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-link${isActive(item.href) ? " active" : ""}`}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-signal-deck" aria-label="Ambient controls">
        <AmbientPlayer />
      </div>
      <div className="sidebar-runtime" aria-label="Runtime status">
        <span className="sidebar-runtime-signal" aria-hidden="true" />
        <div>
          <strong>Private by default</strong>
          <span>Runs on this device</span>
        </div>
      </div>
    </aside>
  );
}
