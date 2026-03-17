import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        lora: ["var(--font-lora)", "Georgia", "serif"],
        serif: ["var(--font-lora)", "Georgia", "serif"]
      },
      colors: {
        bg: "hsl(var(--bg))",
        sb: "hsl(var(--sb))",
        cursor: "hsl(var(--cursor))",
        ink: {
          DEFAULT: "hsl(var(--ink))",
          2: "hsl(var(--ink-2))",
          3: "hsl(var(--ink-3))",
          4: "hsl(var(--ink-4))"
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
          hover: "hsl(var(--muted-h))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))"
        }
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "10px",
        xl: "12px",
        pill: "13px",
        full: "9999px"
      },
      boxShadow: {
        float:
          "0 2px 12px 0 hsla(25,18%,12%,0.06), 0 1px 3px 0 hsla(25,18%,12%,0.04)",
        "float-md":
          "0 4px 24px 0 hsla(25,18%,12%,0.08), 0 2px 6px 0 hsla(25,18%,12%,0.04)",
        "float-lg":
          "0 8px 32px 0 hsla(25,18%,12%,0.10), 0 2px 8px 0 hsla(25,18%,12%,0.06)"
      },
      keyframes: {
        menuIn: {
          from: { opacity: "0", transform: "translateY(6px) scale(0.99)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" }
        },
        fadeIn: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        "menu-in": "menuIn 150ms ease",
        "fade-in": "fadeIn 180ms ease"
      },
      transitionTimingFunction: {
        layout: "var(--ease-layout)"
      }
    }
  },
  plugins: []
}

export default config
