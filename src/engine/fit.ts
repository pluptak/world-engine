// Nothing here fixes an orientation, so the longest dimensions meet the destination's
// longest: a 20 by 100 thing fits a 120 by 60 table, and a 70 cm chair leg does not fit a
// 35 cm chest. The first failing pair in descending order names the refusal data.
export function misfit(
  item: number[],
  destination: number[],
): { item_cm: number; space_cm: number } | null {
  const itemDescending = [...item].sort((left, right) => right - left);
  const destinationDescending = [...destination].sort((left, right) => right - left);
  for (const [index, value] of itemDescending.entries()) {
    const space = destinationDescending[index] ?? 0;
    if (value > space) {
      return { item_cm: value, space_cm: space };
    }
  }
  return null;
}

// The space a plain container offers, from its three `inner_*_cm` props, or null when it declares
// none (such a container takes nothing by `put`, and no state rule reads it).
export function innerDimensions(props: Readonly<Record<string, number | string | boolean>>): number[] | null {
  const width = props.inner_w_cm;
  const depth = props.inner_d_cm;
  const height = props.inner_h_cm;
  if (typeof width !== "number" || typeof depth !== "number" || typeof height !== "number") {
    return null;
  }
  return [width, depth, height];
}
