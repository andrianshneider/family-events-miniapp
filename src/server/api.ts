import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "./errors";
import { log } from "./log";
import { measured } from "./performance";
import { MissingSettingError } from "./config";
export const reply = (data: unknown, requestId: string, status = 200) =>
  NextResponse.json(
    { data, requestId },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    },
  );
export function endpoint(
  handler: (request: Request, requestId: string) => Promise<Response>,
) {
  return async (request: Request) => {
    const requestId = randomUUID(),
      start = Date.now();
    try {
      const { value: response, serverTiming } = await measured(
        () => handler(request, requestId),
        requestId,
      );
      response.headers.set("Server-Timing", serverTiming);
      log("request", {
        requestId,
        status: response.status,
        durationMs: Date.now() - start,
      });
      return response;
    } catch (caught) {
      const error =
        caught instanceof z.ZodError
          ? new AppError(
              422,
              "VALIDATION_ERROR",
              "Проверьте поля.",
              z.flattenError(caught).fieldErrors as Record<string, string[]>,
            )
          : caught;
      const known = error instanceof AppError;
      const status = known ? error.status : 500;
      log("request_failed", {
        requestId,
        status,
        code: known ? error.code : operationalCode(error),
        ...(error instanceof MissingSettingError
          ? { missingSetting: error.settingName }
          : {}),
        durationMs: Date.now() - start,
      });
      return NextResponse.json(
        {
          error: {
            code: known ? error.code : "INTERNAL_ERROR",
            message: known ? error.message : "Не удалось выполнить запрос.",
            ...(known && error.fieldErrors
              ? { fieldErrors: error.fieldErrors }
              : {}),
          },
          requestId,
        },
        {
          status,
          headers: {
            "Cache-Control": "private, no-store",
            "X-Request-Id": requestId,
          },
        },
      );
    }
  };
}
export async function input<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 16384,
  allowEmpty = false,
): Promise<T> {
  const json = request.headers
    .get("content-type")
    ?.startsWith("application/json");
  if (!json && !allowEmpty)
    throw new AppError(400, "INVALID_CONTENT_TYPE", "Требуется JSON.");
  const reader = request.body?.getReader();
  if (!reader && allowEmpty) return schema.parse(undefined);
  if (!reader) throw new AppError(400, "INVALID_JSON", "Пустой запрос.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new AppError(400, "BODY_TOO_LARGE", "Слишком большой запрос.");
    }
    chunks.push(value);
  }
  if (bytes === 0 && allowEmpty) return schema.parse(undefined);
  if (!json) throw new AppError(400, "INVALID_CONTENT_TYPE", "Требуется JSON.");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_JSON", "Некорректный JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Проверьте поля.",
      z.flattenError(result.error).fieldErrors as Record<string, string[]>,
    );
  return result.data;
}

function operationalCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{1,48}$/.test(error.code)
  )
    return error.code;
  return "INTERNAL_ERROR";
}
