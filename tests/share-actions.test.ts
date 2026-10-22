import { it, expect, vi } from "vitest";
import { nativeShare, copyInvitation } from "@/lib/share-actions";
import { mapsUrl, telegramShareUrl, type Invitation } from "@/lib/invitation";
const invitation: Invitation = {
  publicUrl: "https://example.test/e/abcdefghijklmnopqrstuv",
  event: {
    publicId: "abcdefghijklmnopqrstuv",
    title: "Праздник",
    eventDate: "2030-01-01",
    startTime: null,
    endTime: null,
    timezone: "Europe/Moscow",
    eventType: "family",
    isPast: false,
    venueName: null,
    address: null,
    directions: null,
    description: null,
    dressCode: null,
    coverUrl: null,
    routeUrl: null,
    version: 1,
  },
};
it("invokes native share synchronously in the click stack, treats cancellation separately and uses the canonical Telegram fallback", async () => {
  let resolve!: () => void;
  const share = vi.fn((data: ShareData) => {
    expect(data.url).toBe(invitation.publicUrl);
    return new Promise<void>((r) => {
      resolve = r;
    });
  });
  const pending = nativeShare(invitation, { share });
  expect(share).toHaveBeenCalledTimes(1); // Before awaiting a network or deferred operation.
  expect(share.mock.calls[0][0]).toMatchObject({
    url: invitation.publicUrl,
    title: invitation.event.title,
  });
  resolve();
  expect(await pending).toBe("ready");
  expect(
    await nativeShare(invitation, {
      share: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    }),
  ).toBe("cancelled");
  await expect(
    nativeShare(invitation, {
      share: async () => {
        throw new Error("Denied");
      },
    }),
  ).rejects.toThrow("Denied");
  expect(await nativeShare(invitation, {})).toBe("unsupported");
  const telegram = vi.fn();
  expect(
    await nativeShare(invitation, {
      share,
      telegram: { openTelegramLink: telegram },
    }),
  ).toBe("ready");
  const url = new URL(telegram.mock.calls[0][0]);
  expect(url.origin).toBe("https://t.me");
  expect(url.pathname).toBe("/share/url");
  expect(url.searchParams.get("url")).toBe(invitation.publicUrl);
  expect(share).toHaveBeenCalledTimes(1);
  expect(telegramShareUrl(invitation)).not.toContain("initData");
});
it("confirms clipboard only after resolution and propagates failure for manual selection", async () => {
  let resolve!: () => void;
  let completed = false;
  const writeText = vi.fn((data: string) => {
    expect(data).toBe(invitation.publicUrl);
    return new Promise<void>((r) => {
      resolve = r;
    });
  });
  const pending = copyInvitation(invitation.publicUrl, { writeText }).then(
    () => {
      completed = true;
    },
  );
  expect(writeText).toHaveBeenCalledWith(invitation.publicUrl);
  expect(completed).toBe(false);
  resolve();
  await pending;
  expect(completed).toBe(true);
  await expect(
    copyInvitation(invitation.publicUrl, undefined),
  ).rejects.toThrow();
  await expect(
    copyInvitation(invitation.publicUrl, {
      writeText: async () => {
        throw Error("Denied");
      },
    }),
  ).rejects.toThrow("Denied");
});
it("omits routes without an address and encodes arbitrary address text within a fixed map URL", () => {
  expect(mapsUrl(null, 55, 37)).toBeNull();
  expect(mapsUrl(" ", null, null)).toBeNull();
  const url = new URL(
    mapsUrl("Москва & https://attacker.test/<script>", null, null)!,
  );
  expect(url.origin).toBe("https://www.google.com");
  expect(url.searchParams.get("query")).toBe(
    "Москва & https://attacker.test/<script>",
  );
});
