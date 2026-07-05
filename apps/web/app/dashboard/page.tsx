"use client";

import { motion } from "framer-motion";
import { useProject } from "@/hooks/use-project";
import { useQueues, useLiveInvalidation } from "@/hooks/use-queries";
import { CenteredSpinner } from "@/components/ui/spinner";
import { Hero3D } from "@/components/dashboard/Hero3D";
import { QueueHealthGrid } from "@/components/dashboard/QueueHealthGrid";
import { WorkerMonitor } from "@/components/dashboard/WorkerMonitor";
import { ThroughputChart } from "@/components/dashboard/ThroughputChart";
import { StatusOverview } from "@/components/dashboard/StatusOverview";
import { JobExplorer } from "@/components/dashboard/JobExplorer";
import { SubmitJobForm } from "@/components/dashboard/SubmitJobForm";
import { DlqView } from "@/components/dashboard/DlqView";
import { SchedulesView } from "@/components/dashboard/SchedulesView";
import { Onboarding } from "@/components/dashboard/QuickStart";

function Section({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

export default function DashboardPage() {
  const { projectId, projects, isLoading } = useProject();
  const { data: queues, isLoading: queuesLoading } = useQueues(projectId);

  // Layer live WS invalidation over the polling baseline.
  useLiveInvalidation();

  if (isLoading) {
    return <CenteredSpinner label="Loading your workspace…" />;
  }

  if (projects.length === 0) {
    return <Onboarding needsProject />;
  }

  if (!projectId || queuesLoading) {
    return <CenteredSpinner label="Loading queues…" />;
  }

  if ((queues?.length ?? 0) === 0) {
    return <Onboarding needsProject={false} />;
  }

  return (
    <div className="space-y-4">
      <Section>
        <Hero3D />
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section delay={0.05} className="lg:col-span-2">
          <ThroughputChart />
        </Section>
        <Section delay={0.1}>
          <StatusOverview />
        </Section>
      </div>

      <Section delay={0.12}>
        <QueueHealthGrid />
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section delay={0.14} className="lg:col-span-2">
          <JobExplorer />
        </Section>
        <div className="flex flex-col gap-4">
          <Section delay={0.16}>
            <WorkerMonitor />
          </Section>
          <Section delay={0.18}>
            <SubmitJobForm />
          </Section>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section delay={0.2}>
          <DlqView />
        </Section>
        <Section delay={0.22}>
          <SchedulesView />
        </Section>
      </div>
    </div>
  );
}
