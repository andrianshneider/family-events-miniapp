import { organizer } from "@/server/auth/sessions";
import { redirect } from "next/navigation";
import { AppError } from "@/server/errors";
import { LoginScreen } from "@/components/login-screen";
export const dynamic = "force-dynamic";
export default async function Login() {
  let authenticated = false;
  try {
    await organizer();
    authenticated = true;
  } catch (e) {
    if (!(e instanceof AppError && e.status === 401)) throw e;
  }
  if (authenticated) redirect("/events");
  return <LoginScreen />;
}
