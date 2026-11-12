import { organizer } from "@/server/auth/sessions";
import { redirect } from "next/navigation";
import { AppError } from "@/server/errors";
import { LoginScreen } from "@/components/login-screen";
import { returnPath } from "@/server/telegram/oidc";
export const dynamic = "force-dynamic";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  let authenticated = false;
  try {
    await organizer();
    authenticated = true;
  } catch (e) {
    if (!(e instanceof AppError && e.status === 401)) throw e;
  }
  const params = await searchParams;
  const destination = returnPath(params.returnTo ?? null);
  if (authenticated) redirect(destination);
  return (
    <LoginScreen
      returnTo={destination}
      initialError={
        params.error === "telegram"
          ? "Вход через Telegram не завершён или устарел. Повторите попытку."
          : ""
      }
    />
  );
}
