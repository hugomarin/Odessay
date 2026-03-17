import { createBrowserClient } from "@supabase/ssr";
import { supabasePublicKey, supabaseUrl } from "@/utils/supabase/shared";

export const createClient = () =>
  createBrowserClient(supabaseUrl, supabasePublicKey);
