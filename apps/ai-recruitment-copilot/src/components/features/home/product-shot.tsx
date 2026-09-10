// 用途：Hero 下方的产品主截图大图，滚动驱动轻微缩小
// Purpose: Hero shot of the primary product surface; subtle scroll-driven scale-down.
"use client";

import { ResumesScreen } from "@/components/features/home/screens/resumes-screen";
import { Section } from "./section";

// 顶部小 padding 让截图露出首屏一半，底部沿用 Section 默认节奏与下方 section 对齐
// Small top keeps the screenshot peeking above the fold; default bottom keeps section rhythm consistent.
export function ProductShot() {
  return (
    <Section className="!pt-8 sm:!pt-10" width="wide">
      <div className="home-product-shot-enter">
        <div aria-hidden="true" className="home-product-shot-scroll" inert>
          <ResumesScreen />
        </div>
      </div>
    </Section>
  );
}
