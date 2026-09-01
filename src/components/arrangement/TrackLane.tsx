import type { CSSProperties, ReactElement } from "react";

import { Clip } from "@/components/arrangement/Clip";
import { CLIPS } from "@/data/studio-data";
import type { Track } from "@/types/studio";

export function TrackLane({ track, row }: Readonly<{ track: Track; row: number }>): ReactElement {
  return (
    <div className="relative col-start-2 min-w-0 border-b border-white/10 bg-transparent" style={{ gridRow: row } as CSSProperties}>
      {CLIPS.filter((clip) => clip.trackId === track.id).map((clip) => <Clip clip={clip} track={track} key={clip.id} />)}
    </div>
  );
}
