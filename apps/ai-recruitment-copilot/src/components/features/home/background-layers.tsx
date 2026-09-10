// 用途：把首页固定背景动画 + 遮罩抽出为单一组件
// Purpose: extracts the fixed homepage background animation + mask into one component.
"use client";

import { useReducedMotion } from "motion/react";
import { useTheme } from "next-themes";
import { Suspense, lazy, useEffect, useState } from "react";

const MeshGradient = lazy(async () => {
  const mod = await import("@paper-design/shaders-react");
  return { default: mod.MeshGradient };
});
const Grainient = lazy(() => import("@/components/react-bits/grainient"));
const AsciiHero = lazy(async () => {
  const mod = await import("@/components/react-bits/ascii-hero");
  return { default: mod.AsciiHero };
});

export function BackgroundLayers() {
  const { resolvedTheme } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let idleId: number | undefined;
    let timerId: ReturnType<typeof globalThis.setTimeout> | undefined;
    const enableBackground = () => setReady(true);
    function scheduleBackground() {
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(enableBackground, { timeout: 1500 });
      } else {
        timerId = globalThis.setTimeout(enableBackground, 0);
      }
    }
    if (document.readyState === "complete") {
      scheduleBackground();
    } else {
      window.addEventListener("load", scheduleBackground, { once: true });
    }
    return () => {
      window.removeEventListener("load", scheduleBackground);
      if (idleId !== undefined) {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== undefined) {
        globalThis.clearTimeout(timerId);
      }
    };
  }, []);

  const isDark = resolvedTheme === "dark";
  const showBackground = ready && (resolvedTheme === "dark" || resolvedTheme === "light");

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-20 overflow-hidden bg-[linear-gradient(135deg,#b9d6e6,#279cff,#B497CF)] dark:bg-[linear-gradient(135deg,#241d9a,#9f50d3)]"
      >
        {showBackground ? (
          <Suspense fallback={null}>
            {isDark ? (
              <>
                <div className="absolute inset-0">
                  <MeshGradient
                    colors={["#e0eaff", "#241d9a", "#f75092", "#9f50d3"]}
                    distortion={0.8}
                    grainMixer={0}
                    grainOverlay={0}
                    height="100%"
                    maxPixelCount={1_920_000}
                    speed={prefersReducedMotion ? 0 : 1}
                    swirl={0.1}
                    width="100%"
                  />
                </div>
                <div className="absolute inset-0">
                  <AsciiHero fps={30} />
                </div>
              </>
            ) : (
              <>
                <div className="absolute inset-0 opacity-100">
                  <Grainient
                    color1="#b9d6e6"
                    color2="#279cff"
                    color3="#B497CF"
                    timeSpeed={prefersReducedMotion ? 0 : 0.5}
                    colorBalance={0}
                    warpStrength={1}
                    warpFrequency={5}
                    warpSpeed={2}
                    warpAmplitude={50}
                    blendAngle={0}
                    blendSoftness={0.05}
                    rotationAmount={500}
                    noiseScale={3}
                    grainAmount={0.1}
                    grainScale={2}
                    grainAnimated={false}
                    contrast={1.5}
                    gamma={1}
                    saturation={1}
                    centerX={0}
                    centerY={0}
                    zoom={0.9}
                  />
                </div>
                <div className="absolute inset-0">
                  <AsciiHero fps={30} />
                </div>
              </>
            )}
          </Suspense>
        ) : null}
      </div>
      {/* 亮色保留 mask，暗色直接展示 Mesh / Keep the light mask; expose the Mesh directly in dark mode. */}
      <div
        aria-hidden="true"
        className="bg-mask pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(to_bottom,oklch(0.985_0.007_236.5/0.48),oklch(0.985_0.007_236.5/0.68)_42%,oklch(0.985_0.007_236.5/0.82)_100%)] opacity-80 dark:bg-[linear-gradient(to_bottom,oklch(0.145_0_0/0.55),oklch(0.145_0_0/0.72)_42%,oklch(0.145_0_0/0.88)_100%)] dark:opacity-0"
      />
    </>
  );
}
