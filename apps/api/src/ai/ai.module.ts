import { Module, Injectable, Inject, Controller, Post, Param, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { schema, eq, desc, and, type DbHandle } from "@flux/db";
import { DomainError } from "@flux/shared";
import { DB, APP_CONFIG } from "../common/tokens";
import { Roles } from "../common/decorators";
import type { AppConfig } from "../config";

interface AiSummary {
  jobId: string;
  summary: string;
  source: "anthropic" | "heuristic";
  model?: string;
}

/**
 * AI-assisted root-cause summaries for failed jobs (bonus). Sends the job's final error
 * and recent logs to the Anthropic Messages API and returns a concise human-readable
 * explanation + suggested fix. If no ANTHROPIC_API_KEY is configured, it degrades to a
 * deterministic heuristic summary so the feature still works out of the box.
 */
@Injectable()
export class AiService {
  private readonly log = new Logger("AiService");
  private readonly client: Anthropic | null;

  constructor(
    @Inject(DB) private readonly dbh: DbHandle,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    this.client = cfg.anthropicApiKey ? new Anthropic({ apiKey: cfg.anthropicApiKey }) : null;
  }

  async summarizeFailure(jobId: string): Promise<AiSummary> {
    const [job] = await this.dbh.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
    if (!job) throw new DomainError("NOT_FOUND", "Job not found");

    const failedExecs = await this.dbh.db
      .select()
      .from(schema.jobExecutions)
      .where(and(eq(schema.jobExecutions.jobId, jobId), eq(schema.jobExecutions.status, "failed")))
      .orderBy(desc(schema.jobExecutions.attemptNo))
      .limit(3);

    const logs = await this.dbh.db
      .select({ level: schema.jobLogs.level, message: schema.jobLogs.message, ts: schema.jobLogs.ts })
      .from(schema.jobLogs)
      .where(eq(schema.jobLogs.jobId, jobId))
      .orderBy(desc(schema.jobLogs.ts))
      .limit(40);

    const context = [
      `Job: ${job.name} (type=${job.type}, status=${job.status})`,
      `Attempts: ${job.attempts}/${job.maxAttempts}`,
      `Final error: ${job.lastError ?? "(none recorded)"}`,
      `Payload: ${JSON.stringify(job.payload).slice(0, 500)}`,
      "",
      "Failed attempts:",
      ...failedExecs.map((e) => `  attempt ${e.attemptNo}: ${e.error ?? "(no error)"}`),
      "",
      "Recent logs (newest first):",
      ...logs.slice(0, 40).map((l) => `  [${l.level}] ${l.message}`),
    ].join("\n");

    if (this.client) {
      try {
        const model = this.cfg.anthropicModel;
        const message = await this.client.messages.create({
          model,
          max_tokens: 1024,
          system:
            "You are an SRE assistant for a distributed job scheduler. Given a failed job's error and logs, respond with a concise root-cause analysis (2-4 sentences) followed by a short 'Suggested fix:' line. Be specific and practical. Plain text, no preamble.",
          messages: [{ role: "user", content: `Analyze this failed job and explain what went wrong:\n\n${context}` }],
        });
        const summary = message.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return { jobId, summary, source: "anthropic", model };
      } catch (err) {
        this.log.warn({ err: String(err) }, "Anthropic call failed; falling back to heuristic");
      }
    }

    return { jobId, summary: this.heuristic(job.lastError, logs.map((l) => l.message)), source: "heuristic" };
  }

  /** Deterministic fallback: pattern-match the error to a likely cause + fix. */
  private heuristic(error: string | null, logs: string[]): string {
    const blob = `${error ?? ""}\n${logs.join("\n")}`.toLowerCase();
    const rules: Array<[RegExp, string]> = [
      [/timeout|timed out|etimedout/, "The job exceeded its time budget or a downstream call timed out. Suggested fix: raise the timeout, add retries with backoff, or make the work incremental."],
      [/econnrefused|connection refused|network|enotfound|dns/, "A network dependency was unreachable. Suggested fix: verify the target host/port and health, and add a circuit breaker or retry policy."],
      [/permission|forbidden|unauthor|401|403/, "The job lacked permission for a resource. Suggested fix: check credentials/scopes and IAM/role configuration."],
      [/not found|404|no such/, "A referenced resource was missing. Suggested fix: validate inputs and ensure the resource exists before enqueuing."],
      [/out of memory|oom|heap/, "The job ran out of memory. Suggested fix: reduce batch size, stream data, or increase the worker's memory."],
      [/rate limit|429|too many requests/, "A rate limit was hit. Suggested fix: lower the queue concurrency limit or add token-bucket throttling."],
      [/parse|json|syntax|invalid/, "The payload or a response failed to parse. Suggested fix: validate the payload schema at creation time."],
    ];
    for (const [re, msg] of rules) if (re.test(blob)) return msg;
    return `The job failed with: "${error ?? "unknown error"}". Suggested fix: inspect the execution logs above, reproduce locally with the same payload, and add targeted error handling. (Set ANTHROPIC_API_KEY to enable AI-generated root-cause analysis.)`;
  }
}

@Controller()
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post("jobs/:jobId/ai-summary")
  @Roles("member")
  summarize(@Param("jobId") jobId: string) {
    return this.ai.summarizeFailure(jobId);
  }
}

@Module({
  providers: [AiService],
  controllers: [AiController],
})
export class AiModule {}
