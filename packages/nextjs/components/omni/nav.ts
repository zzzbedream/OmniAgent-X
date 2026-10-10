import type { ComponentType, SVGProps } from "react";
import {
  ChartBarSquareIcon,
  CommandLineIcon,
  FingerPrintIcon,
  HomeIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";

export type NavItem = { label: string; href: string; Icon: ComponentType<SVGProps<SVGSVGElement>> };

/** App sections, in the order of the demo flow. Shared by the header (desktop) and the tab bar (mobile). */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Home", href: "/", Icon: HomeIcon },
  { label: "Account", href: "/onboard", Icon: FingerPrintIcon },
  { label: "Strategy", href: "/intent", Icon: CommandLineIcon },
  { label: "Risk", href: "/dashboard", Icon: ChartBarSquareIcon },
  { label: "Guardian", href: "/guardian", Icon: ShieldCheckIcon },
];
