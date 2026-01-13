
document.addEventListener('DOMContentLoaded', function() {
  const themeToggle = document.getElementById('theme-toggle');
  // Theme switching
    themeToggle.onclick = function() {
      isDark = !isDark;
      window.applyTheme(isDark);
      // Save theme preference to Gun if logged in
      if (window.user && window.user.is && window.user.is.pub) {
        window.user.get('theme').put(isDark);
      }
    };
});

// Utility to generate a random color
function getRandomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

// Fallback: if color missing, generate from username
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xFF;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color;
}