import { useEffect, useState } from "react";

/**
 * The IANA timezone list, with `selected` guaranteed to be in it.
 *
 * Resolved in an effect, never during render: `Intl.supportedValuesOf` doesn't
 * exist during SSR (nor in every engine), so computing it inline would either
 * 500 the server render or produce a hydration mismatch. It returns `[]` on the
 * server and fills in on the client.
 *
 * `selected` is prepended when the list doesn't contain it - a zone stored
 * before the engine knew about it must still render as chosen rather than
 * leaving an empty box that silently rewrites the user's setting on save.
 *
 * An empty `selected` is never prepended. "" isn't a timezone, and Radix throws
 * on `<SelectItem value="">` - so a caller that renders for one frame before its
 * data has loaded would take the whole page down rather than briefly show a
 * blank box.
 */
export function useTimezones(selected: string): string[] {
  const [zones, setZones] = useState<string[]>([]);

  useEffect(() => {
    try {
      setZones(Intl.supportedValuesOf("timeZone") as string[]);
    } catch {
      setZones([]);
    }
  }, []);

  if (!selected || zones.includes(selected)) return zones;
  return [selected, ...zones];
}
