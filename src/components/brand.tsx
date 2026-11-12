import Image from "next/image";
/** The approved Meetmallow mark, shared by Organizer and public Guest screens. */
export function Brand() {
  return (
    <div className="brand">
      <Image
        unoptimized
        className="brand-icon"
        src="/icons/meetmallow-192.png"
        width={48}
        height={48}
        alt=""
        aria-hidden="true"
      />
      <span className="brand-name">Meetmallow</span>
    </div>
  );
}
