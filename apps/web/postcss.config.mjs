/**
 * @file postcss.config
 * @description PostCSS configuration for the web app.
 *
 * Responsibilities:
 * - Wire the Tailwind CSS v4 PostCSS plugin
 */

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
