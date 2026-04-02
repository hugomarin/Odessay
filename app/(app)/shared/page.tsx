import { redirect } from "next/navigation"

export default function SharedPage() {
  redirect("/desk?tab=shared")
}
