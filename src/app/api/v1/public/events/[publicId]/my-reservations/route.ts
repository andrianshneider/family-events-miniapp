import { endpoint, reply } from "@/server/api";
import { limit } from "@/server/auth/rate-limit";
import { myReservations } from "@/server/services/reservations";
export const GET = (
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) =>
  endpoint(async (req, id) => {
    await limit(
      req,
      "public",
      Number(process.env.PUBLIC_READ_RATE_LIMIT ?? 120),
    );
    return reply(
      await myReservations(
        (await context.params).publicId,
        new URL(req.url).searchParams.get("cursor"),
      ),
      id,
    );
  })(request);
