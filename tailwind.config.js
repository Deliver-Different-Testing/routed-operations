import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./Views/**/*.cshtml', './wwwroot/app/react/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#14152D',
          cyan: '#43C7F4',
          purple: '#606DB4',
          orange: '#F2994A',
        },
        surface: {
          white: '#ffffff',
          light: '#f6f8fa',
          cream: '#fafbfc',
        },
        border: {
          DEFAULT: '#e8ecf1',
          light: '#f1f5f9',
        },
        text: {
          primary: '#0d0c2c',
          secondary: '#374151',
          muted: '#4b5563',
        },
        success: { DEFAULT: '#10b981', bg: '#d1fae5' },
        warning: { DEFAULT: '#f59e0b', bg: '#fef3c7' },
        error: { DEFAULT: '#ef4444', bg: '#fee2e2' },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0, 14, 37, 0.05)',
        md: '0 2px 8px rgba(0, 14, 37, 0.08)',
        lg: '0 4px 12px rgba(0, 14, 37, 0.12)',
        'cyan-glow': '0 4px 12px rgba(67, 199, 244, 0.3)',
      },
    },
  },
  plugins: [forms],
};
