import { redirect } from "next/navigation"

export default function NewWritePage() {
  redirect("/write?new=1")
}
