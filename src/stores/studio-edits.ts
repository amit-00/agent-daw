import { SOUND_CATALOG } from "@/audio/catalog";
import { PROJECT_CAPS, type ArrangementClip, type PatternLengthBars, type Project, type Track } from "@/project";

export function getDrumKitProblem(track: Track, soundIds: readonly string[]): string | null {
  const kit = SOUND_CATALOG.drumKits.find((item) => item.id === track.instrumentId);
  if (!kit) return `The drum kit on ${track.name} is unavailable. Choose an available kit.`;
  const missing = soundIds.find((soundId) => !kit.soundIds.includes(soundId));
  return missing ? `${track.name}'s kit lacks ${missing}. Choose a compatible kit or remove that sound.` : null;
}

export function getPlacementProblem(project: Project, clip: ArrangementClip): string | null {
  const pattern = project.patterns.find((item) => item.id === clip.patternId);
  const track = project.tracks.find((item) => item.id === clip.trackId);
  if (!pattern || !track) return "That pattern or track no longer exists. Choose another destination.";
  if (pattern.kind !== track.kind) return `${pattern.name} needs a compatible instrument. Choose another track.`;
  if (pattern.kind === "drum") {
    const problem = getDrumKitProblem(track, pattern.events.map((hit) => hit.soundId));
    if (problem) return problem;
  }
  if (!Number.isInteger(clip.startBar) || clip.startBar < 0) return "Choose a whole starting bar of 1 or later.";
  if (!Number.isInteger(clip.repeatCount) || clip.repeatCount < 1 || clip.repeatCount > 64) return "Choose a whole repeat count between 1 and 64.";
  const end = clip.startBar + pattern.lengthBars * clip.repeatCount;
  if (end > PROJECT_CAPS.maxArrangementBars) return `Clips must end within ${PROJECT_CAPS.maxArrangementBars} bars. Move or shorten this clip.`;
  for (const other of project.arrangement) {
    if (other.id === clip.id || other.trackId !== clip.trackId) continue;
    const otherPattern = project.patterns.find((item) => item.id === other.patternId)!;
    const otherEnd = other.startBar + otherPattern.lengthBars * other.repeatCount;
    if (clip.startBar < otherEnd && other.startBar < end) return `This would overlap ${otherPattern.name} on ${track.name}. Choose a free bar.`;
  }
  return null;
}

export function getPatternLengthProblem(project: Project, patternId: string, lengthBars: PatternLengthBars): string | null {
  const pattern = project.patterns.find((item) => item.id === patternId);
  if (!pattern) return "That pattern no longer exists. Select another pattern.";
  if (![1, 2, 4].includes(lengthBars)) return "Choose a pattern length of 1, 2, or 4 bars.";
  const endStep = lengthBars * 16;
  const truncates = pattern.kind === "drum"
    ? pattern.events.some((hit) => hit.startStep >= endStep)
    : pattern.events.some((note) => note.startStep + note.lengthSteps > endStep);
  if (truncates) return `Shorten or remove events beyond step ${endStep} before reducing this pattern's length.`;
  const candidate: Project = { ...project, patterns: project.patterns.map((item) => item.id === patternId ? { ...item, lengthBars } : item) };
  for (const clip of candidate.arrangement) {
    if (clip.patternId !== patternId) continue;
    const problem = getPlacementProblem(candidate, clip);
    if (problem) return problem;
  }
  return null;
}
