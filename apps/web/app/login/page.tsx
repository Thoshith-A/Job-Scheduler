"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Boxes, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const { status, login, signup } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await signup({ email, password, name, organizationName: orgName || undefined });
      }
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === "INVALID_CREDENTIALS"
            ? "Invalid email or password."
            : err.code === "CONFLICT"
              ? "That email is already registered."
              : err.message,
        );
      } else {
        setError("Something went wrong. Is the API running on http://localhost:4000?");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* Ambient studio glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-amber/10 blur-[140px]" />
        <div className="absolute bottom-0 right-0 h-[400px] w-[500px] rounded-full bg-cyan/10 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber/30 bg-amber/10 shadow-glow">
            <Boxes className="h-7 w-7 text-amber" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Flux Control Room</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {mode === "login" ? "Sign in to your fleet" : "Create your operator account"}
          </p>
        </div>

        <form onSubmit={onSubmit} className="glass space-y-4 p-6">
          <AnimatePresence mode="popLayout">
            {mode === "signup" && (
              <motion.div
                key="name-fields"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4 overflow-hidden"
              >
                <div>
                  <Label htmlFor="name">Your name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ada Lovelace"
                    required={mode === "signup"}
                    autoComplete="name"
                  />
                </div>
                <div>
                  <Label htmlFor="org">Organization name (optional)</Label>
                  <Input
                    id="org"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Acme Robotics"
                    autoComplete="organization"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-lg border border-crit/30 bg-crit/10 px-3 py-2 text-xs text-crit"
            >
              {error}
            </motion.p>
          )}

          <Button type="submit" loading={busy} className="w-full justify-center">
            <Sparkles className="h-4 w-4" />
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>

          <p className="text-center text-xs text-ink-muted">
            {mode === "login" ? "No account yet?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError(null);
              }}
              className="font-medium text-amber hover:text-amber-soft focus-ring"
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </p>
        </form>
      </motion.div>
    </main>
  );
}
