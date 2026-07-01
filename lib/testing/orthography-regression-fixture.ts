import type { MechanicalCorrection } from "@/lib/services/contracts/ai-service"

export const ORTHOGRAPHY_REGRESSION_SCOPE = "perf-orthography-regression"
export const ORTHOGRAPHY_REGRESSION_WRITING_ID = "13192f3a-d68e-4ff9-bcf8-fe02cce6b8aa"
export const ORTHOGRAPHY_REGRESSION_AUTHOR_ID = "perf-user"
export const ORTHOGRAPHY_REGRESSION_CREATED_AT = "2026-06-27T19:55:09.811Z"

export const ORTHOGRAPHY_REGRESSION_MARKDOWN = `Quiero escribir un texto que me permita revisar cómo está funcioando la ortografía de la aplicació de escritorio creo que tienes varios problemas. Por ejemplo cuando se hacen las correcciones algunas paralabras que se corrigen cambian.

Por otro lado quiero entender cómo funciona y cómo se mandan los textos si es por aprrafo o como funciona.

Esto me permite evaluar una mejro experiencia de corrección.

Solo asi

Tendremos una buen producto.
`

export const buildOrthographyRegressionCorrections = (
  blockId: string,
  text: string,
): MechanicalCorrection[] => {
  const trimmed = text.trim()

  if (trimmed.includes("funcioando")) {
    return [
      {
        blockId,
        type: "spelling",
        severity: "medium",
        confidence: "high",
        originalText: "funcioando",
        replacementText: "funcionando",
      },
      {
        blockId,
        type: "accent",
        severity: "medium",
        confidence: "high",
        originalText: "aplicació",
        replacementText: "aplicación",
      },
      {
        blockId,
        type: "punctuation",
        severity: "medium",
        confidence: "high",
        originalText: "escritorio creo",
        replacementText: "escritorio. Creo",
      },
      {
        blockId,
        type: "punctuation",
        severity: "medium",
        confidence: "high",
        originalText: "Por ejemplo cuando",
        replacementText: "Por ejemplo, cuando",
      },
      {
        blockId,
        type: "spelling",
        severity: "medium",
        confidence: "high",
        originalText: "paralabras",
        replacementText: "palabras",
      },
    ]
  }

  if (trimmed.includes("aprrafo")) {
    return [
      {
        blockId,
        type: "accent",
        severity: "medium",
        confidence: "high",
        originalText: "aprrafo",
        replacementText: "párrafo",
      },
    ]
  }

  if (trimmed.includes("mejro")) {
    return [
      {
        blockId,
        type: "spelling",
        severity: "medium",
        confidence: "high",
        originalText: "mejro",
        replacementText: "mejor",
      },
    ]
  }

  if (trimmed === "Solo asi") {
    return [
      {
        blockId,
        type: "accent",
        severity: "medium",
        confidence: "high",
        originalText: "Solo asi",
        replacementText: "Solo así",
      },
    ]
  }

  if (trimmed === "Tendremos una buen producto.") {
    return [
      {
        blockId,
        type: "agreement",
        severity: "medium",
        confidence: "high",
        originalText: "Tendremos una buen producto",
        replacementText: "Tendremos un buen producto",
      },
    ]
  }

  return []
}
