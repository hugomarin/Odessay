const readRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
};

const readSupabasePublicKey = (): string => {
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = publishable ?? anon;

  if (!key) {
    throw new Error(
      "Missing env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return key;
};

const supabaseUrl = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabasePublicKey = readSupabasePublicKey();

export { supabasePublicKey, supabaseUrl };
