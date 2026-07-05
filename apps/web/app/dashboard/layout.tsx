"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { ProjectProvider } from "@/hooks/use-project";
import { TopBar } from "@/components/dashboard/TopBar";
import { CenteredSpinner } from "@/components/ui/spinner";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <CenteredSpinner label="Authenticating…" />
      </main>
    );
  }

  return (
    <ProjectProvider>
      <div className="min-h-screen">
        <TopBar />
        <main className="mx-auto max-w-[1600px] px-4 pb-16 pt-6 md:px-6">{children}</main>
      </div>
    </ProjectProvider>
  );
}
