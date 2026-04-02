import { notFound } from "next/navigation"
import type { JSONContent } from "@tiptap/core"
import { ReadingView } from "@/components/reading/reading-view"

const isHarnessEnabled =
  process.env.NODE_ENV !== "production" || process.env.ODESSAY_PERF_HARNESS_ENABLED === "true"

// Synthetic ~1500-word writing in TipTap JSONContent format for perf tracing.
const HARNESS_BODY_JSON: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Reading both of you, I keep coming back to something that neither of you named directly but that I feel underneath both texts: the discomfort of being truly received. Not misunderstood — that's its own problem — but received fully, accurately, with the weight you actually carry.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Hugo, you wrote about not being ready to be present. Mario, you wrote about mistaking withdrawal for receptiveness. What I hear in both is a kind of protective distance — not cruelty, not indifference, but the very human impulse to stay slightly unreachable even in intimacy. We build these small architectures of unavailability and then wonder why closeness feels so exhausting.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "I think this is what makes genuine attention so rare. It's not just that we don't know how to give it — it's that we're often not sure we want to receive it. Being understood is exposing. It means someone has done work on you. It means you owe them the acknowledgment that they got it right.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "And sometimes you're not ready to be gotten right. Sometimes the misunderstanding is the comfort. The version of you that others carry — slightly wrong, slightly softer or harder than you are — is easier to live with than the accurate one. There is a certain mercy in being slightly missed.",
        },
      ],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "The most intimate thing two people can do is agree, without saying so, to stop trying to explain themselves.",
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "What I want to say — and I'm not sure I have the right words yet — is that the silence you described, Hugo, might have been less about attention and more about permission. You were both giving each other permission to not be performing. And that's something different. That's closer to what I'd call rest.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Permission is not the same as understanding. You can give someone permission to be opaque, to be inconsistent, to arrive without explanation — without ever truly knowing them. And maybe that's the more sustainable form of intimacy. Not the kind that sees you fully, but the kind that doesn't require you to be seen.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "I've been sitting with this distinction for days and I'm not sure I've landed anywhere. But I think it matters for what we're trying to do here — in this correspondence, in writing to each other at all. What are we asking for when we invite someone to read what we wrote? Understanding? Or permission?",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "There is a passage in one of Simone Weil's letters where she distinguishes between the attention we pay to ideas and the attention we pay to people. Attention to ideas, she says, is a form of mastery — we take the idea apart, hold it up to light, find its edges. Attention to people is different. It is a form of waiting. You make yourself available without agenda. You hold space without filling it.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "I wonder if what you two were practicing — in that silence, in those hours together without performance — was Weil's second kind of attention. Not the kind that produces understanding, but the kind that produces presence. And maybe presence is what we're really after when we write to each other. Not to be known. To be accompanied.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "The problem with being understood, as I see it now, is that it tends to complete things. Once someone understands you, there's a kind of closure — the loop closes, the energy dissipates. But if you're merely accompanied — if someone walks beside you without claiming to know where you're going — the movement can continue. The conversation stays open.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "I'm aware this could read as a defense of superficiality. It's not. I think there's a deeper form of closeness available on the other side of this — one that doesn't require the other person to become legible to you. That allows for mystery, for growth, for the person to be different tomorrow than they are today.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "What I keep returning to is the word 'receive.' You receive a letter. You receive a guest. In both cases, you are not the one initiating. You're not defining the terms. You're making yourself available to something that arrives on its own schedule, in its own form. You don't get to choose what the letter says. You only get to choose whether you open it.",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "I've been writing this slowly, over several days, because I wanted to get it right. I'm still not sure I have. But I think the act of writing it — of trying to articulate something I sense rather than know — is itself a form of the kind of attention I'm describing. I'm not trying to understand you. I'm trying to be present to what you wrote.",
        },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Lens" }] }],
            },
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Reading" }] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Attention" }] }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Presence" }] }],
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "And maybe that's enough. Maybe that's the thing. To be present to what someone wrote. To let it land. To write back not with answers but with your own arriving.",
        },
      ],
    },
  ],
}

export default function ReadingPerfHarnessPage() {
  if (!isHarnessEnabled) {
    notFound()
  }

  return (
    <ReadingView
      writing={{
        id: "reading-perf-harness",
        title: "The problem with being understood",
        bodyJson: HARNESS_BODY_JSON,
        bodyText:
          "Reading both of you, I keep coming back to something that neither of you named directly but that I feel underneath both texts: the discomfort of being truly received.",
        updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      }}
      author={{ displayName: "Laura Castillo", username: "laura" }}
      prevWritingId={null}
      nextWritingId={null}
      sequencePosition={null}
      sequenceTotal={null}
      canRespond={true}
      backUrl="/shared"
    />
  )
}
