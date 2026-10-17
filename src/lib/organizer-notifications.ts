export type OrganizerNotifications = {
  eventTitle: string;
  enabled: boolean;
  channel: "ready" | "blocked" | "unknown";
  handoff: null | {
    id: string;
    state:
      "pending" | "confirmed" | "cancelled" | "account_mismatch" | "expired";
    expiresAt: string;
  };
};
