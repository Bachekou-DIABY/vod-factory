/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './frontend/src/**/*.{html,ts}',
  ],
  theme: {
    extend: {
      colors: {
        // Cyan : actions principales, états validés, étapes terminées, en ligne.
        accent: {
          DEFAULT: '#42F2F5',
          soft: '#A5F8FA',
          deep: '#0E5C5E',
          ink: '#06282A',
        },
        // Rouge : tout ce qui envoie vers YouTube, les alertes, le reset récupéré.
        // `text` est la variante lisible en petit sur fond sombre : le rouge de
        // base n'y atteint pas le contraste minimal sous 18 px.
        alert: {
          DEFAULT: '#EB1C38',
          text: '#FF7A8C',
          bg: '#2A0A10',
          line: '#7A1424',
          pale: '#FBD5DB',
        },
      },
    },
  },
  plugins: [],
};
