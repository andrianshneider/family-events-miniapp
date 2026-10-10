import "server-only";
// Only explicit operational fields. Never accept arbitrary errors or request objects.
export function log(
  event: string,
  fields: {
    requestId?: string;
    code?: string;
    status?: number;
    durationMs?: number;
    missingSetting?: string;
  } = {},
) {
  console.info(
    JSON.stringify({ event, ...fields, timestamp: new Date().toISOString() }),
  );
}
