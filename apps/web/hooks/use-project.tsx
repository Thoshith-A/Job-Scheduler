"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { Organization, Project } from "@/lib/types";
import { useAuth } from "./use-auth";

const SELECTED_ORG_KEY = "flux.selectedOrg";
const SELECTED_PROJECT_KEY = "flux.selectedProject";

interface ProjectContextValue {
  organizations: Organization[];
  org: Organization | null;
  orgId: string | null;
  projects: Project[];
  project: Project | null;
  projectId: string | null;
  isLoading: boolean;
  canWrite: boolean;
  selectOrg: (orgId: string) => void;
  selectProject: (projectId: string) => void;
  refetchProjects: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { organizations, status } = useAuth();
  const queryClient = useQueryClient();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  // Resolve the active org: persisted → first available.
  useEffect(() => {
    if (status !== "authenticated" || organizations.length === 0) return;
    const persisted =
      typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_ORG_KEY) : null;
    const exists = organizations.find((o) => o.id === persisted);
    setOrgId(exists ? exists.id : organizations[0]!.id);
  }, [organizations, status]);

  const projectsQuery = useQuery({
    queryKey: orgId ? qk.projects(orgId) : ["projects", "none"],
    queryFn: () => api.listProjects(orgId!),
    enabled: !!orgId,
  });

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  // Resolve the active project: persisted → first available.
  useEffect(() => {
    if (projects.length === 0) {
      setProjectId(null);
      return;
    }
    const persisted =
      typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_PROJECT_KEY) : null;
    const exists = projects.find((p) => p.id === persisted);
    setProjectId((current) => {
      if (current && projects.some((p) => p.id === current)) return current;
      return exists ? exists.id : projects[0]!.id;
    });
  }, [projects]);

  const selectOrg = (id: string) => {
    setOrgId(id);
    setProjectId(null);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SELECTED_ORG_KEY, id);
      window.localStorage.removeItem(SELECTED_PROJECT_KEY);
    }
  };

  const selectProject = (id: string) => {
    setProjectId(id);
    if (typeof window !== "undefined") window.localStorage.setItem(SELECTED_PROJECT_KEY, id);
  };

  const org = organizations.find((o) => o.id === orgId) ?? null;
  const project = projects.find((p) => p.id === projectId) ?? null;
  const canWrite = org?.role === "owner" || org?.role === "admin";

  const value = useMemo<ProjectContextValue>(
    () => ({
      organizations,
      org,
      orgId,
      projects,
      project,
      projectId,
      isLoading: status === "loading" || projectsQuery.isLoading,
      canWrite,
      selectOrg,
      selectProject,
      refetchProjects: () => {
        if (orgId) void queryClient.invalidateQueries({ queryKey: qk.projects(orgId) });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [organizations, org, orgId, projects, project, projectId, status, projectsQuery.isLoading, canWrite],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
