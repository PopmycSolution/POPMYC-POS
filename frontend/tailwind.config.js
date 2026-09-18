/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Class-based dark mode — toggled by adding/removing "dark" on <html>
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        'xs': '420px',
      },
      colors: {
        // ── Mint / brand accent ─────────────────────────────────────────────
        mint: {
          50:  '#edfff8',
          100: '#d0fff0',
          200: '#a4ffe2',
          300: '#6bffce',
          400: '#00FFCC',   // primary accent highlight
          500: '#00FFAA',   // primary accent
          600: '#00d48c',
          700: '#00a96e',
          800: '#007f52',
          900: '#005c3b',
        },
        // ── Primary (blue) ──────────────────────────────────────────────────
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // ── Secondary (green) ───────────────────────────────────────────────
        secondary: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        accent: {
          50: '#fdf4ff',
          100: '#fae8ff',
          200: '#f5d0fe',
          300: '#f0abfc',
          400: '#e879f9',
          500: '#d946ef',
          600: '#c026d3',
          700: '#a21caf',
          800: '#86198f',
          900: '#701a75',
        },
        danger: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        muted: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        // ── Dark surface palette ─────────────────────────────────────────────
        dark: {
          50:  '#1e293b',  // card / panel bg
          100: '#172032',  // sidebar bg
          200: '#111827',  // page bg
          300: '#0d1424',  // deep bg
          400: '#263042',  // border / divider
          500: '#334155',  // hover
        },
        brand: {
          red:   '#CE1126',
          gold:  '#FCD116',
          green: '#006B3F',
          star:  '#000000',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        'xs':   '0.75rem',
        'sm':   '0.875rem',
        'base': '1rem',
        'lg':   '1.125rem',
        'xl':   '1.25rem',
        '2xl':  '1.5rem',
        '3xl':  '1.875rem',
        '4xl':  '2.25rem',
        '5xl':  '3rem',
      },
      borderRadius: {
        'none': '0',
        'sm':   '0.125rem',
        'md':   '0.375rem',
        'lg':   '0.5rem',
        'xl':   '0.75rem',
        '2xl':  '1rem',
        '3xl':  '1.5rem',
        'full': '9999px',
      },
      boxShadow: {
        'card':   '0 1px 3px 0 rgba(0,0,0,.06), 0 1px 2px -1px rgba(0,0,0,.04)',
        'panel':  '0 4px 16px 0 rgba(0,0,0,.08)',
        'modal':  '0 20px 60px -10px rgba(0,0,0,.2)',
        'mint':   '0 0 20px 0 rgba(0,255,170,.18)',
        'mintlg': '0 0 40px 0 rgba(0,255,170,.25)',
        'glow':   '0 0 0 3px rgba(0,255,170,.30)',
      },
      keyframes: {
        'slide-up':       { from: { transform: 'translateY(12px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        'slide-down':     { from: { transform: 'translateY(-8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        'fade-in':        { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in':       { from: { transform: 'scale(0.96)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'pulse-mint':     { '0%,100%': { boxShadow: '0 0 0 0 rgba(0,255,170,.4)' }, '50%': { boxShadow: '0 0 0 8px rgba(0,255,170,0)' } },
      },
      animation: {
        'slide-up':       'slide-up 0.22s cubic-bezier(.22,.61,.36,1) both',
        'slide-down':     'slide-down 0.2s cubic-bezier(.22,.61,.36,1) both',
        'fade-in':        'fade-in 0.18s ease-out both',
        'scale-in':       'scale-in 0.2s cubic-bezier(.22,.61,.36,1) both',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'pulse-mint':     'pulse-mint 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
