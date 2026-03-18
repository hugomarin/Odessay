const supabaseUrlValue = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!supabaseUrlValue) {
  throw new Error("Missing env NEXT_PUBLIC_SUPABASE_URL");
}

const supabasePublicKeyValue =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabasePublicKeyValue) {
  throw new Error(
    "Missing env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}

const supabaseUrl: string = supabaseUrlValue;
const supabasePublicKey: string = supabasePublicKeyValue;

export { supabasePublicKey, supabaseUrl };
