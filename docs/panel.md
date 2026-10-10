# Panel: the local control of a device

A panel is a link on a device's control walk (`templates/panel.json`, `panel: true`, a definition
in `src/engine/fields.ts`). The controller works a device through it as through any link
([power.md](power.md)); a subject at the panel works it too, without the controller.

- **Who works it:** an actor that is not the device's controller and cannot reach the device by
  hand works it through the nearest intact panel on the device's control walk, first from the
  device, that it reaches (`panelFor`, `src/engine/power.ts`). It needs no key, hands or reach to
  the device, as the controller does.
- **Where a link fails:** `open`, `close`, `lock` and `unlock` through a panel are refused
  `disconnected` or `unpowered` as the controller's are, the walk taken only as far as that panel:
  the panel included, the rest of the walk to the controller not (`panelFault`).
- **By hand first:** an actor that can reach the device works it by hand as before, with the key
  and the hands; a panel in reach does not change that.
- **Naming:** a device a panel serves for an actor is addressable and offered by `options` to that
  actor wherever it stands, as the controller's are (`gropable`, `resolve.ts`).
- **Jams:** a command through a panel is remote: a `jam_pct` device jams it too ([jam.md](jam.md)).
- **Links beyond it:** a destroyed or unpowered link between the panel and the controller refuses
  only the controller; the subject's walk ends at the panel.

Not modelled: a keyed or locked panel, panels for cameras, intercoms or the arm, and priority
between the controller and a subject at a panel: each command is decided against the world as the
last one left it. Tests: `tests/panel.test.ts`, and step L of `tests/scenario-lab.test.ts`.
