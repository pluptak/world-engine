# Bleeding

The second kind of scheduled cause ([schedule.md](schedule.md)), and the first that chains. A body
bleeds when its props declare `bleed_damage`, `bleed_every_ticks` and `bleed_times`, all positive
integers; a human declares 5, 2 and 3. A template without them (a dog, a cat) never bleeds.

**A wound.** When `attack` severs a part, the body gets a `bleed` cause due `bleed_every_ticks`
after the `detached`, with `remaining: bleed_times`. Each bleed takes `bleed_damage` from the body's
own `integrity` under a `damaged` event caused by the cause before it, and schedules the next with
one fewer left. The chain reads `detached` → `damaged` → `damaged` → `damaged`, and a trace of the
body's `integrity` walks it. Every bleed falls during whichever command spans its tick, so a long
`wait` runs a whole wound. Two wounds bleed side by side, each on its own count.

**Bleeding out.** A bleed that brings `integrity` to 0 emits `destroyed` and sets `status`; a
destroyed body is no agent any more, so its own commands are `invalid` with `not_an_agent`, it
senses nothing (`observer_destroyed`, [perception.md](perception.md)), and its other bleeds find it
so and do nothing. What its grips and mouth held falls where it lies, each fall caused by the
`destroyed`; what is pocketed stays with the body. The props are read when each bleed runs, so an
edit that removes them stops a wound.

`tests/bleeding.test.ts` is the spec, with the inn script, where ann bleeds after losing an arm.
The property test's generator aims half its blows at parts that come off and gives its bob a
severing blow, so wounds open and bleed under every property; a test there fails if random runs
stop reaching them.

What it does not do: nothing stops a bleed but its count, the body's end or an edit (there is no
bandage); a detachment written by `edit` opens no wound; and bleeding costs no capacity, only the
body's integrity.
