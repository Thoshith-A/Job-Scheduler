"use client";

import { useEffect, useState } from "react";
import { Rocket, Zap, ShieldAlert, Dices, CalendarClock } from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useQueues, useCreateJob } from "@/hooks/use-queries";
import { useToast } from "@/components/ui/toast";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/field";
import type { CreateJobBody, JobType } from "@/lib/types";

interface Preset {
  key: string;
  label: string;
  icon: React.ReactNode;
  type: JobType;
  name: string;
  payload: string;
  extra?: { cron?: string };
}

const PRESETS: Preset[] = [
  { key: "normal", label: "Normal", icon: <Zap className="h-3.5 w-3.5" />, type: "immediate", name: "normal-job", payload: '{\n  "sleepMs": 800\n}' },
  { key: "fail", label: "Always fail", icon: <ShieldAlert className="h-3.5 w-3.5" />, type: "immediate", name: "always-fail", payload: '{\n  "fail": true\n}' },
  { key: "flaky", label: "Flaky", icon: <Dices className="h-3.5 w-3.5" />, type: "immediate", name: "flaky-job", payload: '{\n  "failRate": 0.3\n}' },
  {
    key: "cron",
    label: "Cron",
    icon: <CalendarClock className="h-3.5 w-3.5" />,
    type: "recurring",
    name: "every-minute",
    payload: '{\n  "steps": ["a", "b"]\n}',
    extra: { cron: "*/1 * * * *" },
  },
];

export function SubmitJobForm() {
  const { projectId } = useProject();
  const { data: queues = [] } = useQueues(projectId);
  const { toast } = useToast();
  const create = useCreateJob();

  const [queueId, setQueueId] = useState("");
  const [type, setType] = useState<JobType>("immediate");
  const [name, setName] = useState("normal-job");
  const [payload, setPayload] = useState('{\n  "sleepMs": 800\n}');
  const [delayMs, setDelayMs] = useState(5000);
  const [runAt, setRunAt] = useState("");
  const [cron, setCron] = useState("*/1 * * * *");
  const [timezone, setTimezone] = useState("UTC");
  const [batchText, setBatchText] = useState('[\n  { "sleepMs": 200 },\n  { "sleepMs": 400 }\n]');
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [payloadError, setPayloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!queueId && queues.length > 0) setQueueId(queues[0]!.id);
  }, [queues, queueId]);

  const applyPreset = (p: Preset) => {
    setType(p.type);
    setName(p.name);
    setPayload(p.payload);
    if (p.extra?.cron) setCron(p.extra.cron);
    setPayloadError(null);
  };

  function buildBody(): CreateJobBody | null {
    setPayloadError(null);
    if (type === "batch") {
      let arr: unknown;
      try {
        arr = JSON.parse(batchText);
      } catch {
        setPayloadError("Batch payloads must be a valid JSON array.");
        return null;
      }
      if (!Array.isArray(arr) || arr.length === 0) {
        setPayloadError("Provide a non-empty JSON array of payloads.");
        return null;
      }
      return { type: "batch", name, payloads: arr as Record<string, unknown>[] };
    }

    let parsed: Record<string, unknown> = {};
    if (payload.trim()) {
      try {
        parsed = JSON.parse(payload);
      } catch {
        setPayloadError("Payload must be valid JSON.");
        return null;
      }
    }

    switch (type) {
      case "immediate":
        return { type: "immediate", name, payload: parsed };
      case "delayed":
        return { type: "delayed", name, payload: parsed, delayMs };
      case "scheduled": {
        if (!runAt) {
          setPayloadError("Pick a run time.");
          return null;
        }
        return { type: "scheduled", name, payload: parsed, runAt: new Date(runAt).toISOString() };
      }
      case "recurring":
        return { type: "recurring", name, payload: parsed, cron, timezone };
      default:
        return { type: "immediate", name, payload: parsed };
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = buildBody();
    if (!body || !queueId) return;
    create.mutate(
      { queueId, body, idempotencyKey: idempotencyKey.trim() || undefined },
      {
        onSuccess: (res) => {
          if (res.kind === "batch") {
            toast({ tone: "success", title: "Batch enqueued", message: `${res.count} jobs created` });
          } else if (res.kind === "schedule") {
            toast({ tone: "success", title: "Schedule created", message: res.schedule.name });
          } else {
            toast({
              tone: "success",
              title: res.deduplicated ? "Deduplicated (idempotent)" : "Job enqueued",
              message: res.job.name,
            });
          }
        },
        onError: (err) => toast({ tone: "error", title: "Submit failed", message: (err as Error).message }),
      },
    );
  }

  if (queues.length === 0) {
    return (
      <Card>
        <CardHeader title="Submit job" icon={<Rocket className="h-4 w-4" />} />
        <EmptyState title="Create a queue first" hint="Jobs are submitted to a queue." />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Submit job" icon={<Rocket className="h-4 w-4" />} subtitle="Enqueue work to a queue" />

      {/* Presets */}
      <div className="mb-4 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => applyPreset(p)}
            className="flex items-center gap-1.5 rounded-lg border border-edge bg-white/[0.03] px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-amber/40 hover:text-amber-soft focus-ring"
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Queue</Label>
            <Select value={queueId} onChange={(e) => setQueueId(e.target.value)}>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as JobType)}>
              <option value="immediate">immediate</option>
              <option value="delayed">delayed</option>
              <option value="scheduled">scheduled</option>
              <option value="recurring">recurring</option>
              <option value="batch">batch</option>
            </Select>
          </div>
        </div>

        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </div>

        {type === "delayed" && (
          <div>
            <Label>Delay (ms)</Label>
            <Input type="number" min={0} value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))} />
          </div>
        )}
        {type === "scheduled" && (
          <div>
            <Label>Run at</Label>
            <Input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
          </div>
        )}
        {type === "recurring" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cron</Label>
              <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="*/5 * * * *" />
            </div>
            <div>
              <Label>Timezone</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
            </div>
          </div>
        )}

        <div>
          <Label>{type === "batch" ? "Payloads (JSON array)" : "Payload (JSON)"}</Label>
          {type === "batch" ? (
            <Textarea rows={5} value={batchText} onChange={(e) => setBatchText(e.target.value)} className="text-xs" />
          ) : (
            <Textarea rows={4} value={payload} onChange={(e) => setPayload(e.target.value)} className="text-xs" />
          )}
          {payloadError && <p className="mt-1 text-xs text-crit">{payloadError}</p>}
        </div>

        {type !== "batch" && type !== "recurring" && (
          <div>
            <Label>Idempotency key (optional)</Label>
            <Input value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} placeholder="e.g. order-1234" />
          </div>
        )}

        <Button type="submit" loading={create.isPending} className="w-full justify-center">
          <Rocket className="h-4 w-4" />
          Enqueue job
        </Button>
      </form>
    </Card>
  );
}
