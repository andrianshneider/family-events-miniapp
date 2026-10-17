export function OrganizerHeader({ displayName }: { displayName: string }) {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <header className="top">
      <div className="brand">
        <span aria-hidden="true">♡</span> Family Events
      </div>
      <span
        className="organizer-avatar"
        title={displayName}
        aria-label={`Организатор: ${displayName}`}
      >
        {initials}
      </span>
    </header>
  );
}
