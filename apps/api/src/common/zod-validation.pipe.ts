import { PipeTransform, Injectable } from "@nestjs/common";
import type { ZodSchema } from "zod";
import { DomainError } from "@flux/shared";

/**
 * Validate request bodies/queries against a Zod schema from @flux/shared. Using the same
 * schemas the frontend imports keeps a single source of truth for the API contract and
 * turns validation failures into our structured VALIDATION_ERROR envelope.
 */
/** Imperative validation (for cases where the value is assembled from params + body). */
export function zParse<T>(schema: ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DomainError("VALIDATION_ERROR", "Request validation failed", result.error.flatten());
  }
  return result.data;
}

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError("VALIDATION_ERROR", "Request validation failed", result.error.flatten());
    }
    return result.data;
  }
}
