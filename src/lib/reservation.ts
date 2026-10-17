export type OwnReservation = {
  reservationId: string;
  giftId: string;
  reservedAt: string;
};
export type ReservationContext = {
  reservations: OwnReservation[];
  nextCursor: string | null;
  defaultName: string | null;
  sessionState: "active" | "none" | "lost";
  contextKey: string | null;
};
