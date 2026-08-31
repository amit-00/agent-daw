import type { ReactElement } from "react";

import { Studio } from "@/components/Studio";
import { DEMO_PROJECT } from "@/data/studio-data";

export default function StudioPage(): ReactElement {
  return <Studio initialProject={DEMO_PROJECT} />;
}
