import { createBrowserClient } from "@supabase/ssr"
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/shared"

export const createClient = () =>
  createBrowserClient(supabaseUrl, supabasePublicKey)
