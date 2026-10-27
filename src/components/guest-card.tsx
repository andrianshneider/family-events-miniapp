import { adultsCount, childrenCount } from "@/lib/russian-count";
import type { Rsvp } from "@/lib/rsvp";
export function GuestCard({ guest }: { guest: Rsvp }) {
  return (
    <article className="panel guest-card">
      <h3>{guest.guestName}</h3>
      <p className="guest-status">
        {{ yes: "Будет", no: "Не будет", maybe: "Пока не знает" }[guest.status]}
      </p>
      {guest.status !== "no" && (
        <p>
          {adultsCount(guest.adultsCount)} ·{" "}
          {childrenCount(guest.childrenCount)}
        </p>
      )}
      {guest.comment && <p className="guest-comment">{guest.comment}</p>}
    </article>
  );
}
