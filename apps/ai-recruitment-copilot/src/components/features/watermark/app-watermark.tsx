import { useEffect, useMemo } from "react";
import { authClient } from "@/lib/client/auth-client";

interface WatermarkUser {
  email?: string | null;
  name?: string | null;
}

export function buildWatermarkContent(user: WatermarkUser): [string, string] | null {
  const email = user.email?.trim();
  if (!email) {
    return null;
  }

  return [user.name?.trim() || "用户", email];
}

export function AppWatermark() {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user;
  const content = useMemo(() => {
    if (isPending || !user) {
      return null;
    }

    return buildWatermarkContent({
      email: user.email,
      name: user.name,
    });
  }, [isPending, user]);

  useEffect(() => {
    if (!content) {
      return;
    }

    const watermarkContent = content;
    let disposed = false;
    let instance: { create: () => Promise<void>; destroy: () => void } | null = null;

    async function createWatermark() {
      const { Watermark } = await import("watermark-js-plus");

      if (disposed) {
        return;
      }

      instance = new Watermark({
        backgroundRepeat: "repeat",
        content: watermarkContent.join("\n"),
        contentType: "multi-line-text",
        fontColor: "rgba(71, 85, 105, 0.12)",
        fontFamily: "MiSans, Arial, sans-serif",
        fontSize: "14px",
        fontWeight: "500",
        height: 160,
        lineHeight: 22,
        monitorProtection: true,
        mutationObserve: true,
        rotate: 24,
        textAlign: "center",
        textBaseline: "middle",
        width: 260,
        zIndex: 2_147_483_647,
      });

      void instance.create();
    }

    void createWatermark();

    return () => {
      disposed = true;
      instance?.destroy();
    };
  }, [content]);

  return null;
}
