import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/supabase/shared";

export const createAdminClient = () =>
  createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
