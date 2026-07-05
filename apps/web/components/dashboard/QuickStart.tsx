"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FolderPlus, Layers, Rocket, Lock } from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useCreateProject, useCreateQueue } from "@/hooks/use-queries";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { slugify } from "@/lib/format";

/** Onboarding gate: ensures the operator has a project + at least one queue. */
export function Onboarding({ needsProject }: { needsProject: boolean }) {
  return (
    <div className="mx-auto max-w-lg py-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber/30 bg-amber/10 shadow-glow">
            <Rocket className="h-6 w-6 text-amber" />
          </div>
          <h2 className="text-lg font-semibold text-ink">
            {needsProject ? "Create your first project" : "Add a queue to get started"}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {needsProject
              ? "A project groups your queues, jobs, and workers."
              : "Queues are the channels your jobs flow through."}
          </p>
        </div>
        {needsProject ? <CreateProjectForm /> : <CreateQueueForm />}
      </motion.div>
    </div>
  );
}

function NoPermission({ what }: { what: string }) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Lock className="h-6 w-6 text-ink-faint" />
        <p className="text-sm text-ink-muted">You need an admin or owner role to create a {what}.</p>
        <p className="text-xs text-ink-faint">Ask an organization admin to set one up.</p>
      </div>
    </Card>
  );
}

export function CreateProjectForm({ onDone }: { onDone?: () => void }) {
  const { orgId, canWrite, selectProject, refetchProjects } = useProject();
  const create = useCreateProject();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  if (!canWrite) return <NoPermission what="project" />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    create.mutate(
      { orgId, body: { name, slug } },
      {
        onSuccess: (p) => {
          toast({ tone: "success", title: "Project created", message: p.name });
          refetchProjects();
          selectProject(p.id);
          onDone?.();
        },
        onError: (err) => toast({ tone: "error", title: "Create failed", message: (err as Error).message }),
      },
    );
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>Project name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production Pipeline" required autoFocus />
        </div>
        <div>
          <Label>Slug</Label>
          <Input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            pattern="[a-z0-9-]+"
            placeholder="production-pipeline"
            required
          />
        </div>
        <Button type="submit" loading={create.isPending} className="w-full justify-center">
          <FolderPlus className="h-4 w-4" /> Create project
        </Button>
      </form>
    </Card>
  );
}

export function CreateQueueForm({ onDone }: { onDone?: () => void }) {
  const { projectId, canWrite } = useProject();
  const create = useCreateQueue(projectId ?? "");
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [concurrency, setConcurrency] = useState(10);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  if (!canWrite) return <NoPermission what="queue" />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    create.mutate(
      { name, slug, concurrencyLimit: concurrency },
      {
        onSuccess: (q) => {
          toast({ tone: "success", title: "Queue created", message: q.name });
          onDone?.();
        },
        onError: (err) => toast({ tone: "error", title: "Create failed", message: (err as Error).message }),
      },
    );
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Queue name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Emails" required autoFocus />
          </div>
          <div>
            <Label>Concurrency</Label>
            <Input type="number" min={1} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} />
          </div>
        </div>
        <div>
          <Label>Slug</Label>
          <Input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            pattern="[a-z0-9-]+"
            placeholder="emails"
            required
          />
        </div>
        <Button type="submit" loading={create.isPending} className="w-full justify-center">
          <Layers className="h-4 w-4" /> Create queue
        </Button>
      </form>
    </Card>
  );
}
