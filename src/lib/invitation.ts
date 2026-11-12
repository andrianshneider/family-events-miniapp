import { eventDateLabel } from "@/components/event-presentation";
export type PublicEvent = {
  publicId: string;
  title: string;
  eventType: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  timezone: string;
  isPast: boolean;
  venueName: string | null;
  address: string | null;
  directions: string | null;
  description: string | null;
  dressCode: string | null;
  coverUrl: string | null;
  routeUrl: string | null;
  version: number;
};
export type Invitation = { event: PublicEvent; publicUrl: string };
export function eventWhen(
  event: Pick<PublicEvent, "eventDate" | "startTime" | "endTime">,
) {
  return (
    eventDateLabel(event.eventDate) +
    (event.startTime
      ? ` · ${event.startTime}${event.endTime ? "–" + event.endTime : ""}`
      : "")
  );
}
export function invitationText(event: PublicEvent) {
  return `${event.title}\n${eventWhen(event)}${event.venueName ? "\n" + event.venueName : ""}`;
}
export function mapsUrl(
  address: string | null,
  latitude: number | null,
  longitude: number | null,
) {
  if (!address?.trim()) return null;
  const url = new URL("https://www.google.com/maps/search/");
  url.search = new URLSearchParams({
    api: "1",
    query:
      latitude != null && longitude != null
        ? `${latitude},${longitude}`
        : address.trim(),
  }).toString();
  return url.toString();
}
export function telegramShareUrl(invitation: Invitation) {
  const url = new URL("https://t.me/share/url");
  url.search = new URLSearchParams({
    url: invitation.publicUrl,
    text: invitationText(invitation.event),
  }).toString();
  return url.toString();
}
