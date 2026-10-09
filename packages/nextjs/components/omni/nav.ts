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
  { label: "Inicio", href: "/", Icon: HomeIcon },
  { label: "Cuenta", href: "/onboard", Icon: FingerPrintIcon },
  { label: "Estrategia", href: "/intent", Icon: CommandLineIcon },
  { label: "Riesgo", href: "/dashboard", Icon: ChartBarSquareIcon },
  { label: "Guardián", href: "/guardian", Icon: ShieldCheckIcon },
];
