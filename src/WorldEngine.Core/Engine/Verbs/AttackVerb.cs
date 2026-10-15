using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The attack verb (src/engine/verbs/attack.ts): an actor strikes a thing it can reach, or a part of it. A fist needs hands,
// a bite a jaw; the damage of the mode used comes from the attacker's props. Harm lands on the struck part or on the whole
// body. A part that gives out and is detachable comes off, and its wound bleeds; a capacity the blow takes away drops what
// the body held by it.
public static class AttackVerb
{
    public static Pipeline.VerbDecl Attack { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: Preconditions,
        OneTick: true,
        AimsAtParts: true,
        Transition: Transition);

    // A fist needs hands, a bite a jaw; the damage of the mode used comes from the attacker's template.
    public sealed record AttackMode(string Capacity, long AtLeast, Prop<long> DamageProp, string CrossesGap);

    public static readonly IReadOnlyList<AttackMode> Modes =
    [
        new(Capacity.Manipulation, 1, Prop.AttackDamage, "limb"),
        new(Capacity.MouthCarry, 1, Prop.BiteDamage, "body"),
    ];

    private sealed record Structure(string EntityId, string? PartName);

    private sealed record Choice(AttackMode? Mode, long Damage, string Kind);

    // The entity a blow lands on, and the part it lands on: the part named, else the template's default hit part.
    private static Structure? StructureOf(Pipeline.CommandContext context)
    {
        var target = context.Target;
        if (target is null || !context.Snapshot.Entities.TryGetValue(target.EntityId, out var entity)
            || !context.Registry.TryGetValue(entity.Template, out var template))
        {
            return null;
        }
        var partName = target.Part;
        if (partName is null && template.Parts.Count > 0)
        {
            partName = template.Props.Get(Prop.DefaultHitPart);
            if (partName is null)
            {
                return null;
            }
        }
        if (partName is not null && !template.Parts.Any(part => part.Name == partName))
        {
            return null;
        }
        return new Structure(entity.Id, partName);
    }

    // The first mode the attacker can use: enough of its capacity and a usable damage value. Having a capacity but no
    // damage is template data gone wrong, reported apart from the refusal.
    private static Choice ChooseAttack(Pipeline.CommandContext context)
    {
        var hadCapacity = false;
        foreach (var mode in Modes)
        {
            if ((Capacities.Of(context.Snapshot, context.Registry, context.Command.Actor, mode.Capacity) ?? 0) < mode.AtLeast)
            {
                continue;
            }
            hadCapacity = true;
            var actor = context.Snapshot.Entities[context.Command.Actor];
            if (actor.Props.Get(mode.DamageProp) is { } damage && damage > 0)
            {
                return new Choice(mode, damage, "chosen");
            }
        }
        return new Choice(null, 0, hadCapacity ? "no_damage" : "no_capacity");
    }

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        if (context.Target is null)
        {
            return Pipeline.Invalid(Code.MissingTarget);
        }
        if (StructureOf(context) is not { } structure)
        {
            return Pipeline.Invalid(Code.InvalidAttackTarget);
        }

        var snapshot = context.Snapshot;
        var entity = snapshot.Entities[structure.EntityId];
        if (Address.OutOfReach(snapshot, context.Command.Actor, entity.Id) is { } reach)
        {
            return reach;
        }
        // A blow at what is destroyed already would change nothing but say it was destroyed again.
        var template = context.Registry[entity.Template];
        var struck = structure.PartName is null ? null : PartStates.Effective(template, entity, structure.PartName);
        if (entity.Status == EntityStatus.Destroyed || struck?.Status == PartStatus.Destroyed)
        {
            return Pipeline.Refused(Code.AlreadyDestroyed);
        }

        var choice = ChooseAttack(context);
        if (choice.Kind == "no_capacity")
        {
            var first = Modes[0];
            var have = Capacities.Of(snapshot, context.Registry, context.Command.Actor, first.Capacity) ?? 0;
            return new Pipeline.Refusal(
                Status.Refused,
                Pipeline.Insufficient(first.Capacity),
                Pipeline.Reason(("capacity", first.Capacity), ("have", have), ("need", first.AtLeast)));
        }
        if (choice.Kind == "no_damage")
        {
            return Pipeline.Invalid(Code.InvalidAttackTarget);
        }
        // A fist goes through bars on an arm; a bite needs the head, measured as the attacker's body.
        if (choice.Mode!.CrossesGap == "body"
            && Address.GapRefusal(snapshot, context.Registry, context.Command.Actor, context.Command.Actor, entity.Id) is { } gap)
        {
            return gap;
        }
        return null;
    }

    // The part names below a part, including itself, sorted.
    private static List<string> DescendantNames(IReadOnlyList<PartDecl> parts, string rootName)
    {
        var byName = parts.ToDictionary(part => part.Name, StringComparer.Ordinal);
        bool IsInSubtree(string name)
        {
            var parent = byName.TryGetValue(name, out var decl) ? decl.Parent : null;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            while (parent is not null)
            {
                if (parent == rootName)
                {
                    return true;
                }
                if (!seen.Add(parent))
                {
                    throw new InvalidOperationException($"Part cycle at {parent}");
                }
                parent = byName.TryGetValue(parent, out var up) ? up.Parent : null;
            }
            return false;
        }
        return [.. parts.Select(part => part.Name).Where(name => name == rootName || IsInSubtree(name)).Order(StringComparer.Ordinal)];
    }

    // The room under a thing, or the room a support chain ends in (src/engine/verbs/attack.ts `floorSupport`).
    private static string? FloorSupport(Snapshot snapshot, string entityId)
    {
        var entity = snapshot.Entities.GetValueOrDefault(entityId);
        if (entity is null)
        {
            return null;
        }
        if (entity.Location is not null && snapshot.Entities.GetValueOrDefault(entity.Location)?.Template == TemplateIds.Room)
        {
            return entity.Location;
        }
        var supportId = entity.Support;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        while (supportId is not null)
        {
            if (!seen.Add(supportId))
            {
                throw new InvalidOperationException($"Support cycle at {supportId}");
            }
            if (!snapshot.Entities.TryGetValue(supportId, out var support))
            {
                return null;
            }
            if (support.Template == TemplateIds.Room)
            {
                return support.Id;
            }
            supportId = support.Support;
        }
        return null;
    }

    // One `capability_changed` per capacity whose level moved, caused by the blow (src/engine/verbs/attack.ts).
    private static Dictionary<string, string> EmitCapabilityChanges(
        Working working,
        string entityId,
        IReadOnlyDictionary<string, long>? before,
        IReadOnlyDictionary<string, long>? after,
        string causeId)
    {
        var names = (before?.Keys ?? []).Concat(after?.Keys ?? []).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal);
        var events = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var name in names)
        {
            var from = before is not null && before.TryGetValue(name, out var was) ? was : 0;
            var to = after is not null && after.TryGetValue(name, out var now) ? now : 0;
            if (from != to)
            {
                var eventId = working.Emit(
                    EventType.CapabilityChanged,
                    entityId,
                    Pipeline.Reason(("capacity", name), ("from", from), ("to", to)),
                    causeId);
                events[name] = eventId;
            }
        }
        return events;
    }

    // A thing that breaks by a blow to the whole body leaves its break residue where it lay.
    private static void AddBreakResidue(Working working, IReadOnlyDictionary<string, Template> registry, string entityId, string eventId)
    {
        var entity = working.Snapshot.Entities[entityId];
        var template = registry[entity.Template];
        var surfaceId = entity.Support ?? entity.ContainedIn ?? entity.Location;
        if (surfaceId is null || template.BreakResidue.Count == 0)
        {
            return;
        }
        Residue.Add(working, surfaceId, template.BreakResidue, eventId);
    }

    // A part that gives out comes off the body: the body keeps only the severed root, and a detached template spawns
    // carrying the part's own subtree of state (src/engine/verbs/attack.ts `detachPart`).
    private static void DetachPart(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        string partName,
        long nextIntegrity,
        string eventId)
    {
        var entity = working.Snapshot.Entities[entityId];
        var template = registry[entity.Template];
        if (!template.Parts.Any(part => part.Name == partName))
        {
            throw new InvalidOperationException($"Unknown part {partName}");
        }

        var subtree = DescendantNames(template.Parts, partName);
        var subtreeSet = subtree.ToHashSet(StringComparer.Ordinal);
        // The body keeps only the severed root; what hung below it reads as detached through it, and its own state
        // travels with the spawned entity below.
        var remaining = new Dictionary<string, PartState>(entity.Parts, StringComparer.Ordinal);
        foreach (var name in subtree)
        {
            remaining.Remove(name);
        }
        working.SetParts(
            entityId,
            PartStates.With(template, remaining, new Dictionary<string, PartState>(StringComparer.Ordinal)
            {
                [partName] = new PartState(nextIntegrity, PartStatus.Detached),
            }),
            eventId);

        var detachedTemplateId = $"{entity.Template}.{partName}";
        if (!registry.TryGetValue(detachedTemplateId, out var detachedTemplate))
        {
            throw new InvalidOperationException($"Missing detached part template {detachedTemplateId}");
        }
        var detachedPos = Geometry.EffectivePos(working.Snapshot, entityId);
        var support = FloorSupport(working.Snapshot, entityId);
        var spawned = working.SpawnUnder(
            registry,
            detachedTemplateId,
            new Spawn.Overrides(
                Location: support,
                Support: support,
                Pos: detachedPos,
                Name: partName,
                DetachedFrom: new DetachedFrom(entityId, partName),
                Integrity: nextIntegrity),
            eventId,
            eventId);

        var copiedParts = new Dictionary<string, PartState>(StringComparer.Ordinal);
        foreach (var part in detachedTemplate.Parts)
        {
            if (!subtreeSet.Contains(part.Name) || part.Name == partName)
            {
                throw new InvalidOperationException($"Detached template {detachedTemplateId} does not match its part subtree");
            }
            copiedParts[part.Name] = PartStates.State(template, entity, part.Name)!;
        }
        working.SetParts(
            spawned.Id,
            PartStates.With(detachedTemplate, new Dictionary<string, PartState>(StringComparer.Ordinal), copiedParts),
            spawned.EventId);
    }

    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var structure = StructureOf(context) ?? throw new InvalidOperationException("Attack target changed after validation");
        var choice = ChooseAttack(context);
        if (choice.Kind != "chosen")
        {
            throw new InvalidOperationException("Attack mode changed after validation");
        }
        var damage = choice.Damage;
        var registry = context.Registry;

        var target = working.Snapshot.Entities[structure.EntityId];
        var template = registry[target.Template];
        var before = Capacities.All(working.Snapshot, registry, target.Id);
        var structuralBefore = Capacities.StructuralAll(working.Snapshot, registry, target.Id);
        string damageEvent;
        string? detachEvent = null;

        if (structure.PartName is { } partName)
        {
            var part = template.Parts.First(decl => decl.Name == partName);
            var state = PartStates.State(template, target, partName)!;
            var integrity = Math.Max(0, state.Integrity - damage);
            if (integrity == 0 && part.Detachable)
            {
                damageEvent = working.Emit(EventType.Detached, target.Id, Pipeline.Reason(("part", partName)), rootEventId);
                detachEvent = damageEvent;
                DetachPart(working, registry, target.Id, partName, integrity, damageEvent);
                Schedule.StartBleeding(working, target.Id, damageEvent, partName);
            }
            else if (integrity == 0)
            {
                damageEvent = working.Emit(EventType.Destroyed, target.Id, Pipeline.Reason(("part", partName)), rootEventId);
                working.SetParts(
                    target.Id,
                    PartStates.With(template, target.Parts, new Dictionary<string, PartState>(StringComparer.Ordinal)
                    {
                        [partName] = new PartState(integrity, PartStatus.Destroyed),
                    }),
                    damageEvent);
            }
            else
            {
                damageEvent = working.Emit(
                    EventType.Damaged,
                    target.Id,
                    Pipeline.Reason(("part", partName), ("integrity", integrity)),
                    rootEventId);
                working.SetParts(
                    target.Id,
                    PartStates.With(template, target.Parts, new Dictionary<string, PartState>(StringComparer.Ordinal)
                    {
                        // A blow leaves a tie or an incision as it found it.
                        [partName] = state with { Integrity = integrity, Status = PartStatus.Damaged },
                    }),
                    damageEvent);
                // A blow that bruises a part takes from the capacity it contributes (its first, by name).
                var capacityName = part.Contributes.Keys.Order(StringComparer.Ordinal).FirstOrDefault();
                if (capacityName is not null)
                {
                    var current = working.Snapshot.Entities[target.Id];
                    var modifiers = current.Modifiers.Append(new Modifier(
                        capacityName,
                        -(damage / 2),
                        working.Snapshot.Tick + 3,
                        damageEvent)).ToList();
                    working.SetModifiers(target.Id, modifiers, damageEvent);
                }
            }
        }
        else
        {
            var integrity = Math.Max(0, target.Integrity - damage);
            if (integrity == 0)
            {
                damageEvent = working.Emit(EventType.Destroyed, target.Id, Pipeline.Reason(("integrity", integrity)), rootEventId);
                working.SetIntegrity(target.Id, integrity, damageEvent);
                working.SetStatus(target.Id, EntityStatus.Destroyed, damageEvent);
                AddBreakResidue(working, registry, target.Id, damageEvent);
            }
            else
            {
                damageEvent = working.Emit(EventType.Damaged, target.Id, Pipeline.Reason(("integrity", integrity)), rootEventId);
                working.SetIntegrity(target.Id, integrity, damageEvent);
            }
        }

        var after = Capacities.All(working.Snapshot, registry, target.Id);
        var structuralAfter = Capacities.StructuralAll(working.Snapshot, registry, target.Id);
        var capabilityEvents = EmitCapabilityChanges(working, target.Id, before, after, damageEvent);
        // Whatever structurally lost the capacity that held a thing lets it fall; a stunned carrier can hold on until the
        // modifier expires. The cause is the event that took the capacity away.
        var victim = working.Snapshot.Entities[target.Id];
        // A lost part drops what it held first: exactly that part's items, never the other grips or a pocket that
        // survived. What is left still answers to the structural rule below.
        var evicted = Carry.GripEvictions(working.Snapshot, registry, target.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var itemId in working.Snapshot.Entities.Keys.Order(StringComparer.Ordinal).ToList())
        {
            if (!working.Snapshot.Entities.TryGetValue(itemId, out var item) || item.ContainedIn != target.Id)
            {
                continue;
            }
            if (evicted.Contains(itemId))
            {
                DropVerb.DropCarriedItem(working, registry, target.Id, itemId, detachEvent ?? damageEvent);
                continue;
            }
            var lost = Carry.LostCarry(structuralBefore, structuralAfter, victim.Props, item, registry, Carry.Alternatives);
            if (lost is null)
            {
                continue;
            }
            DropVerb.DropCarriedItem(
                working,
                registry,
                target.Id,
                itemId,
                capabilityEvents.GetValueOrDefault(lost) ?? detachEvent ?? damageEvent);
        }
    }
}
