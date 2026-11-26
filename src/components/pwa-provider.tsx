"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import {
  homeInstall,
  initialInstallState,
  type InstallState,
} from "@/lib/home-install";
const Context = createContext<
  InstallState & { install(): void; closeInstructions(): void }
>({ ...initialInstallState, install() {}, closeInstructions() {} });
export const usePwa = () => useContext(Context);
export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(initialInstallState);
  const controller = useRef<ReturnType<typeof homeInstall> | null>(null);
  const [offline, setOffline] = useState(false);
  const install = useCallback(() => controller.current?.install(), []);
  const closeInstructions = useCallback(
    () => controller.current?.closeInstructions(),
    [],
  );
  useEffect(() => {
    const current = homeInstall(window, setState);
    controller.current = current;
    return () => {
      current.dispose();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    let registration: ServiceWorkerRegistration | undefined;
    const sync = () => setOffline(!navigator.onLine);
    const restore = () => {
      if (document.visibilityState !== "visible") return;
      sync();
      if (navigator.onLine) void registration?.update().catch(() => {});
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", restore);
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((value) => {
          registration = value;
          return value.update();
        })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, []);
  return (
    <Context.Provider value={{ ...state, install, closeInstructions }}>
      {offline && (
        <div className="connection-notice" role="status">
          Нет подключения к интернету. Изменения можно сохранить после
          восстановления связи.
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
