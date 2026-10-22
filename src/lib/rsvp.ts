export const rsvpLabels = {
  yes: "Буду",
  no: "Не буду",
  maybe: "Пока не знаю",
} as const;
export type RsvpStatus = keyof typeof rsvpLabels;
export type Rsvp = {
  id: string;
  guestName: string;
  status: RsvpStatus;
  adultsCount: number;
  childrenCount: number;
  comment: string | null;
  version: number;
  updatedAt: string;
};
export type GuestContext = {
  rsvp: Rsvp | null;
  defaultName: string | null;
  notificationsEnabled: boolean;
  sessionState: "none" | "active" | "lost";
  contextKey: string | null;
};
export type Summary = {
  responses: { yes: number; no: number; maybe: number; total: number };
  confirmed: { adults: number; children: number };
};
export type Guests = {
  revision: string;
  event: { id: string; title: string; eventDate: string };
  summary: Summary;
  guests: Rsvp[];
  nextCursor: string | null;
  filter: RsvpStatus | null;
};
