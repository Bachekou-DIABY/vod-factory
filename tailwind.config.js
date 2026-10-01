/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './frontend/src/**/*.{html,ts}',
  ],
  theme: {
    extend: {
      colors: {
        // Turquoise : actions principales, états validés, étapes terminées, en
        // ligne. Entre le cyan #42F2F5 et le vert #4BDE92, assombri : le cyan pur
        // était trop lumineux sur le fond sombre.
        accent: {
          DEFAULT: '#3BCEB1',
          soft: '#7DDCC8',
          deep: '#155E52',
          ink: '#052A24',
        },
        // Rouge : tout ce qui envoie vers YouTube, les alertes, le reset récupéré.
        // Désaturé depuis #EB1C38, qui piquait les yeux en aplat.
        // `text` est la variante lisible en petit sur fond sombre : le rouge de
        // base n'y atteint pas le contraste minimal sous 18 px.
        alert: {
          DEFAULT: '#D33F55',
          text: '#F28C9A',
          bg: '#2A0E14',
          line: '#6B1F2B',
          pale: '#F6D4D9',
        },
      },
    },
  },
  plugins: [],
};
