"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { CenteredSpinner } from "@/components/ui/spinner";

export default function Home() {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
    else if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <CenteredSpinner label="Booting the control room…" />
    </main>
  );
}
