import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { log } from "./log";
type Stage = "session" | "events_db" | "storage_sign" | "profile";
const scope = new AsyncLocalStorage<Record<string, number>>();
export async function timed<T>(
  stage: Stage,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    const values = scope.getStore();
    if (values)
      values[stage] = (values[stage] ?? 0) + performance.now() - start;
  }
}
export async function measured<T>(work: () => Promise<T>, requestId?: string) {
  const values: Record<string, number> = {};
  const start = performance.now();
  const value = await scope.run(values, work);
  values.total = performance.now() - start;
  const timings = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, Math.round(v * 10) / 10]),
  );
  log("performance", { requestId, timings });
  return {
    value,
    serverTiming: Object.entries(timings)
      .map(([k, v]) => `${k};dur=${v}`)
      .join(", "),
  };
}
