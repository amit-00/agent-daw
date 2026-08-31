import type { ReactElement } from "react";

export function Playhead(): ReactElement {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 left-[154px] z-[2]" aria-hidden="true">
      <span className="absolute top-0 bottom-0 left-[27%] w-px bg-white/90" />
      <span className="absolute top-[34px] left-[calc(27%-3px)] h-[7px] w-[7px] rounded-b-full rounded-t-sm bg-white" />
    </div>
  );
}
