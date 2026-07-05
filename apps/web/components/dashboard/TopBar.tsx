"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Boxes, ChevronDown, LogOut, Radio, RadioTower, FolderKanban, Building2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useProject } from "@/hooks/use-project";
import { useSocket } from "@/hooks/use-socket";
import { cn } from "@/lib/cn";

function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

export function TopBar() {
  const { user, logout } = useAuth();
  const { org, organizations, selectOrg, project, projects, selectProject } = useProject();
  const { connected } = useSocket();

  const [orgOpen, setOrgOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const orgRef = useOutsideClose(() => setOrgOpen(false));
  const projRef = useOutsideClose(() => setProjOpen(false));
  const userRef = useOutsideClose(() => setUserOpen(false));

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-void/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 md:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber/30 bg-amber/10 shadow-glow">
            <Boxes className="h-5 w-5 text-amber" />
          </div>
          <span className="hidden text-sm font-semibold tracking-tight text-ink sm:block">Flux</span>
        </div>

        <div className="mx-1 hidden h-6 w-px bg-edge sm:block" />

        {/* Org switcher */}
        <div ref={orgRef} className="relative">
          <button
            onClick={() => setOrgOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg border border-edge bg-white/[0.03] px-3 py-1.5 text-sm text-ink transition-colors hover:bg-white/5 focus-ring"
          >
            <Building2 className="h-4 w-4 text-ink-muted" />
            <span className="max-w-[10rem] truncate">{org?.name ?? "No org"}</span>
            <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
          </button>
          <Dropdown open={orgOpen}>
            {organizations.map((o) => (
              <DropdownItem
                key={o.id}
                active={o.id === org?.id}
                onClick={() => {
                  selectOrg(o.id);
                  setOrgOpen(false);
                }}
              >
                <span className="truncate">{o.name}</span>
                <span className="ml-auto text-[10px] uppercase text-ink-faint">{o.role}</span>
              </DropdownItem>
            ))}
          </Dropdown>
        </div>

        {/* Project switcher */}
        <div ref={projRef} className="relative">
          <button
            onClick={() => setProjOpen((v) => !v)}
            disabled={projects.length === 0}
            className="flex items-center gap-2 rounded-lg border border-edge bg-white/[0.03] px-3 py-1.5 text-sm text-ink transition-colors hover:bg-white/5 focus-ring disabled:opacity-50"
          >
            <FolderKanban className="h-4 w-4 text-ink-muted" />
            <span className="max-w-[10rem] truncate">{project?.name ?? "No project"}</span>
            <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
          </button>
          <Dropdown open={projOpen}>
            {projects.map((p) => (
              <DropdownItem
                key={p.id}
                active={p.id === project?.id}
                onClick={() => {
                  selectProject(p.id);
                  setProjOpen(false);
                }}
              >
                <span className="truncate">{p.name}</span>
                <span className="ml-auto font-mono text-[10px] text-ink-faint">{p.slug}</span>
              </DropdownItem>
            ))}
            {projects.length === 0 && (
              <div className="px-3 py-2 text-xs text-ink-faint">No projects yet</div>
            )}
          </Dropdown>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Live connection status */}
          <div
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:flex",
              connected ? "border-good/30 bg-good/10 text-good" : "border-warn/30 bg-warn/10 text-warn",
            )}
            title={connected ? "Live socket connected" : "Polling only (socket offline)"}
          >
            {connected ? <RadioTower className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
            {connected ? "Live" : "Polling"}
          </div>

          {/* User menu */}
          <div ref={userRef} className="relative">
            <button
              onClick={() => setUserOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-white/5 focus-ring"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber to-amber-deep text-xs font-bold text-void">
                {(user?.name ?? "?").charAt(0).toUpperCase()}
              </span>
              <span className="hidden max-w-[8rem] truncate text-ink-muted md:block">{user?.name}</span>
              <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
            </button>
            <Dropdown open={userOpen} align="right">
              <div className="border-b border-edge px-3 py-2">
                <p className="truncate text-sm text-ink">{user?.name}</p>
                <p className="truncate text-xs text-ink-faint">{user?.email}</p>
              </div>
              <DropdownItem onClick={logout}>
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownItem>
            </Dropdown>
          </div>
        </div>
      </div>
    </header>
  );
}

function Dropdown({
  open,
  children,
  align = "left",
}: {
  open: boolean;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ duration: 0.14 }}
          className={cn(
            "absolute top-full z-50 mt-2 max-h-72 w-56 overflow-y-auto rounded-xl border border-edge bg-studio/95 p-1 shadow-panel backdrop-blur-xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DropdownItem({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/5 focus-ring",
        active ? "text-amber" : "text-ink",
      )}
    >
      {children}
    </button>
  );
}
