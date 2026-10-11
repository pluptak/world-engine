# What ships

**Not in it.** Nothing but a prop moves: no spreading to a neighbour, no spawning.

`templates/lantern.json` burns a point of fuel a tick while `burning` and
snuffs itself at 0, and `candle` extends it with less and, at 0, is used
up (`then: { spent: true }`) instead of only going out
([verbs-sensing.md](verbs-sensing.md), `light`). `human_hungry`
extends `human` (its detachable parts' companions are inherited) with
`hunger` and `starvation`: hunger rises a point every 10 ticks to 100,
and at 100 `starvation` rises every 5 ticks to 20, whose `then` takes all
of the body's integrity. The rise reads `hunger_every` (10 by default) for
its delay. Eating lowers `hunger` below 100, which withdraws the starving
and starts the rise again ([verbs-holding.md](verbs-holding.md),
`consume`); and while `hunger` is below 100 a `recover` process winds
`starvation` back down a point every 5 ticks to 0, so a body that eats
after a lapse recovers. `human` is unchanged, so worlds without a hungry
body keep their hash.
