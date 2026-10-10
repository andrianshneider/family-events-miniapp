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
    idType?: string;
    nameType?: string;
    idValid?: boolean;
    nameValid?: boolean;
  } = {},
) {
  console.info(
    JSON.stringify({ event, ...fields, timestamp: new Date().toISOString() }),
  );
}
