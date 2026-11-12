# Contract notes for Vertical Slice 01

Screen 01, 02 and 20 specifications were read from the approved Google Drive design folder. HTML files remain reference mockups, with simulated actions. No UI redesign was performed.

The technical contract takes precedence where mockups contain older states:
- Event has no draft/status field; upcoming/past derive from effective_at, deletion from deleted_at.
- Invitation route is /e/{publicId}, unlisted and readable without registration; old /invite/:token examples do not imply a personal invitation token table.
- No additional calendar feature or private offline data cache is part of the foundation.
- Guest deep links must not be intercepted by automatic Organizer login navigation.
- Server-verified success must precede entry to My Events. SDK/initDataUnsafe are display/context only.
- Authentication alone never enables notifications; consent plus ready channel is required.

Next slice wires the approved login and My Events composition to the existing server endpoints and real event-list DAL. Browser OIDC and Mini App share the same Telegram identity; PWA context uses the same frontend. Mockup sample counters, statuses and simulated login are not server state.
