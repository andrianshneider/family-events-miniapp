import { endpoint, reply } from "@/server/api";
export const GET = endpoint(async (_request, id) =>
  reply({ status: "ok" }, id),
);
