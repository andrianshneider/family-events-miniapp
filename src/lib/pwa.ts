export type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export function standalone(browser: Pick<Window, "matchMedia" | "navigator">) {
  return (
    browser.matchMedia("(display-mode: standalone)").matches ||
    (browser.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}
export function iphoneSafari(
  nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
) {
  const ios = iosDevice(nav);
  return (
    ios &&
    /Safari/.test(nav.userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/.test(nav.userAgent)
  );
}

export function iosDevice(
  nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
) {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)
  );
}
