"use client";

import * as React from "react";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export type Tab = {
  title: string;
  value: string;
  content?: string | React.ReactNode;
};

export const Tabs = ({
  tabs: propTabs,
  value,
  onValueChange,
  containerClassName,
  activeTabClassName,
  tabClassName,
  contentClassName,
}: {
  tabs: Tab[];
  value?: string;
  onValueChange?: (value: string) => void;
  containerClassName?: string;
  activeTabClassName?: string;
  tabClassName?: string;
  contentClassName?: string;
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [uncontrolledValue, setUncontrolledValue] = useState<string>(
    () => propTabs[0]?.value ?? "",
  );
  const activeValue = value ?? uncontrolledValue;
  const [prevValue, setPrevValue] = useState<string>(activeValue);
  const [switchCount, setSwitchCount] = useState(0);

  if (prevValue !== activeValue) {
    setPrevValue(activeValue);
    setSwitchCount((c) => c + 1);
  }

  const activeIndex = Math.max(
    0,
    propTabs.findIndex((t) => t.value === activeValue),
  );
  const active = propTabs[activeIndex] ?? propTabs[0];
  const orderedTabs = active
    ? [active, ...propTabs.filter((_, idx) => idx !== activeIndex)]
    : propTabs;

  const [hovering, setHovering] = useState(false);

  const moveSelectedTabToTop = (idx: number) => {
    const selectedTab = propTabs[idx];
    if (!selectedTab) return;
    setHovering(false);
    if (value === undefined) {
      setUncontrolledValue(selectedTab.value);
    }
    onValueChange?.(selectedTab.value);
  };

  if (!active) return null;

  return (
    <>
      <div
        role="tablist"
        className={cn(
          "flex flex-row items-center justify-start [perspective:1000px] relative overflow-auto sm:overflow-visible no-visible-scrollbar max-w-full w-full",
          containerClassName,
        )}
      >
        {propTabs.map((tab, idx) => {
          const isSelected = active.value === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => {
                moveSelectedTabToTop(idx);
              }}
              onMouseEnter={() => setHovering(true)}
              onMouseLeave={() => setHovering(false)}
              className={cn("relative px-4 py-2 rounded-full", tabClassName)}
              style={{
                transformStyle: "preserve-3d",
              }}
            >
              {isSelected && (
                <motion.div
                  layoutId="clickedbutton"
                  transition={
                    prefersReducedMotion
                      ? { duration: 0 }
                      : { type: "spring", bounce: 0.3, duration: 0.6 }
                  }
                  className={cn(
                    "absolute inset-0 bg-gray-200 dark:bg-zinc-800 rounded-full ",
                    activeTabClassName,
                  )}
                />
              )}

              <span className="relative block text-black dark:text-white">
                {tab.title}
              </span>
            </button>
          );
        })}
      </div>
      <FadeInDiv
        tabs={orderedTabs}
        active={active}
        key={active.value}
        hovering={hovering}
        animateOnMount={switchCount > 0 && !prefersReducedMotion}
        className={cn("mt-32", contentClassName)}
      />
    </>
  );
};

export const FadeInDiv = ({
  className,
  tabs,
  hovering,
  animateOnMount = true,
}: {
  className?: string;
  key?: string;
  tabs: Tab[];
  active: Tab;
  hovering?: boolean;
  animateOnMount?: boolean;
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [isSwitching, setIsSwitching] = useState(
    () => animateOnMount && !prefersReducedMotion,
  );
  const isActive = (tab: Tab) => {
    return tab.value === tabs[0]?.value;
  };
  const showDeck = Boolean(hovering) || isSwitching;

  return (
    <div className={cn("relative isolate w-full flex-1 min-h-0", className)}>
      {tabs.map((tab, idx) => {
        const front = isActive(tab);
        const elevated = !front || showDeck;
        const cardOpacity = !front && !showDeck ? 0 : idx < 3 ? 1 - idx * 0.1 : 0;

        return (
          <motion.div
            key={tab.value}
            layoutId={prefersReducedMotion ? undefined : tab.value}
            data-card-state={elevated ? "elevated" : "flat"}
            aria-hidden={!front}
            inert={!front}
            style={{
              scale: 1 - idx * 0.1,
              top: hovering && !prefersReducedMotion ? idx * -50 : 0,
              zIndex: -idx,
              opacity: cardOpacity,
            }}
            animate={{
              y: front && animateOnMount && !prefersReducedMotion ? [0, 40, 0] : 0,
            }}
            transition={prefersReducedMotion ? { duration: 0 } : undefined}
            onAnimationComplete={() => {
              if (front && isSwitching) {
                setIsSwitching(false);
              }
            }}
            className={cn(
              "group/tab-card w-full h-full absolute top-0 left-0",
              !front && "pointer-events-none select-none",
            )}
          >
            {tab.content}
          </motion.div>
        );
      })}
    </div>
  );
};
