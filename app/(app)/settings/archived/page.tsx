import { ArchivedWritingsList } from "@/components/settings/archived-writings-list"

export default function ArchivedWritingsPage() {
  return <div id="archived-writings-page" data-page="archived-writings" data-testid="archived-writings-page" className="ArchivedWritingsPage space-y-6"><div><h1 className="font-lora text-[24px] font-medium text-ink">Archived writings</h1><p className="mt-1 text-[13px] text-ink-4">Download, restore, or permanently delete soft-deleted writings.</p></div><ArchivedWritingsList /></div>
}
