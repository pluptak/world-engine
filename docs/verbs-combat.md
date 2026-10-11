# Striking

- `attack`: picks the first mode the attacker can use.
  - A fist reads `attack_damage`. A bite reads `bite_damage`.
  - A bite across bars must fit the gap ([walking.md](walking.md)).
  - A severed part opens a wound that bleeds ([bleeding.md](bleeding.md)).
  - A lost part drops what it held. A stunned victim keeps the rest.
  - A target may be a part: `<id>.<part>`.
  - `options` tries each part of a body in view still on
    (`aims_at_parts`, [verbs.md](verbs.md)).
  - With no part named, the blow falls on `default_hit_part`.
  - A blow at what is destroyed already, or under a destroyed part, is
    `already_destroyed`.
  - Reach is checked first. It emits nothing.
