import {
  invitationText,
  telegramShareUrl,
  type Invitation,
} from "./invitation";
export type SharePlatform = {
  share?: (data: ShareData) => Promise<void>;
  telegram?: { openTelegramLink?: (url: string) => void };
};
// These functions call platform APIs before the first await, preserving user activation.
export async function nativeShare(
  invitation: Invitation,
  platform: SharePlatform,
): Promise<"ready" | "cancelled" | "unsupported"> {
  if (platform.telegram?.openTelegramLink) {
    platform.telegram.openTelegramLink(telegramShareUrl(invitation));
    return "ready";
  }
  if (!platform.share) return "unsupported";
  try {
    await platform.share({
      title: invitation.event.title,
      text: invitationText(invitation.event),
      url: invitation.publicUrl,
    });
    return "ready";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      return "cancelled";
    throw error;
  }
}
export async function copyInvitation(
  publicUrl: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
) {
  if (!clipboard?.writeText) throw Error("CLIPBOARD_UNAVAILABLE");
  await clipboard.writeText(publicUrl);
}
