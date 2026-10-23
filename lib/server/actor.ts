import "server-only";
import { NextResponse } from "next/server";
import { plannerName } from "../env";
import { HttpError } from "./httpError";

export { HttpError };

/**
 * There is no sign-in: every request acts as the single configured planner
 * (PLANNER_NAME). Decisions and POs are recorded under that name.
 */
export interface Actor {
  id: null;
  name: string;
}

export function plannerActor(): Actor {
  return { id: null, name: plannerName() };
}

/** Wraps a route handler: converts thrown errors to JSON without leaking internals. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message, details: e.details ?? null }, { status: e.status });
      }
      console.error("[route error]", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected server error" }, { status: 500 });
    }
  };
}
