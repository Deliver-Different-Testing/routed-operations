/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#14152D',
          cyan: '#43C7F4',
          purple: '#606DB4',
          light: '#f4f2f1',
        },
        // Dane's schedules-module design tokens (admin-schedules-module/tailwind.config.js)
        surface: { white: '#ffffff', light: '#f6f8fa', cream: '#fafbfc' },
        border: { DEFAULT: '#e8ecf1', light: '#f1f5f9' },
        text: { primary: '#0d0c2c', secondary: '#64748b', muted: '#94a3b8' },
        success: { DEFAULT: '#10b981', bg: '#d1fae5' },
        warning: { DEFAULT: '#f59e0b', bg: '#fef3c7' },
        error: { DEFAULT: '#ef4444', bg: '#fee2e2' },
        badge: {
          'blue-bg': '#dbeafe', 'blue-text': '#1e40af',
          'purple-bg': '#ede9fe', 'purple-text': '#6d28d9',
          'green-bg': '#d1fae5', 'green-text': '#065f46',
          'orange-bg': '#fff7ed', 'yellow-bg': '#fefce8',
        },
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0, 14, 37, 0.05)',
        md: '0 2px 8px rgba(0, 14, 37, 0.08)',
        lg: '0 4px 12px rgba(0, 14, 37, 0.12)',
        xl: '0 8px 24px rgba(0, 14, 37, 0.15)',
        'cyan-glow': '0 4px 12px rgba(67, 199, 244, 0.3)',
        sidebar: '-4px 0 24px rgba(0, 14, 37, 0.15)',
      },
      transitionDuration: { fast: '150ms', normal: '200ms', slow: '300ms', expand: '500ms' },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
