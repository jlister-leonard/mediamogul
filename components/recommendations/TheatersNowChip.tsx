import { Chip } from "@/components/ui/Chip";
import type { MoviesInTheatersNowChipData } from "@/lib/availability/theaters";

export interface TheatersNowChipProps {
  data: MoviesInTheatersNowChipData;
  onSelect: (data: MoviesInTheatersNowChipData) => void;
}

/** Minimal E5.4 handoff; the full Recommendations composition belongs to E6.5. */
export function TheatersNowChip({ data, onSelect }: TheatersNowChipProps) {
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Chip
        disabled={data.status === "unknown"}
        aria-label={
          data.status === "present"
            ? `${data.label}, ${data.entries.length} confirmed`
            : `${data.label}, theater list unavailable`
        }
        onClick={() => onSelect(data)}
      >
        {data.label}
      </Chip>
      {data.stale ? (
        <span className="px-2 text-xs text-fg-muted">Theater list may be out of date.</span>
      ) : null}
    </span>
  );
}
