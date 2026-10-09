// React 19 types no longer read the global JSX namespace that
// @shopify/app-bridge-types augments, so declare the App Bridge nav element here.
import type { ReactNode } from "react";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": { children?: ReactNode };
    }
  }
}
