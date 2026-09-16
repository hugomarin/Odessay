const ENTITY_DECODE_ORDER: ReadonlyArray<readonly [string, string]> = [
  ["&quot;", '"'],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&amp;", "&"],
];

export const decodeControlledAttribute = (value: string): string =>
  ENTITY_DECODE_ORDER.reduce(
    (decoded, [entity, character]) => decoded.replaceAll(entity, character),
    value,
  );

export const escapeControlledAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

