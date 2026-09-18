import {
  DOCUMENT_PROJECTION_SURFACES,
  DocumentComponentSpecRegistry,
} from "@/lib/document-components/registry";
import type {
  DocumentComponentKind,
  DocumentProjectionSurface,
} from "@/lib/document-components/types";

export type DocumentComponentCoverage = Partial<
  Record<DocumentComponentKind, readonly DocumentProjectionSurface[]>
>;

export type DocumentComponentCoverageGap = {
  kind: DocumentComponentKind;
  missing: DocumentProjectionSurface[];
};

export const validateDocumentComponentCoverage = (
  coverage: DocumentComponentCoverage,
): DocumentComponentCoverageGap[] =>
  DocumentComponentSpecRegistry.values().flatMap((spec) => {
    const declared = new Set(coverage[spec.kind] ?? []);
    const missing = DOCUMENT_PROJECTION_SURFACES.filter(
      (surface) => !declared.has(surface),
    );
    return missing.length > 0 ? [{ kind: spec.kind, missing }] : [];
  });

