import { parseRegistry, type TemplateRegistry } from "../src/templates.js";

// Fixtures several test files share: presets placed instead of writing definitions, which no
// override or edit may write. A self-closing door or chest extends its shipped preset; an openable
// chest is a chest made openable. `templates/` itself is unchanged.
export const SHARED_FIXTURES: Record<string, unknown> = {
  self_closing_door: {
    id: "self_closing_door",
    extends: "door",
    props: { closes_after: 2 },
  },
  self_closing_chest: {
    id: "self_closing_chest",
    extends: "chest",
    props: { openable: true, open: true, closes_after: 3 },
  },
  open_chest: { id: "open_chest", extends: "chest", props: { openable: true, open: true } },
  shut_chest: { id: "shut_chest", extends: "chest", props: { openable: true, open: false } },
};

export function presetRegistry(base: TemplateRegistry): TemplateRegistry {
  return parseRegistry({ ...base, ...SHARED_FIXTURES });
}
