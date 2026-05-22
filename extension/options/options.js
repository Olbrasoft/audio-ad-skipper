const sel = document.getElementById('quality');

chrome.storage.sync.get({ quality: 'high' }, ({ quality }) => {
  sel.value = quality;
});

sel.addEventListener('change', () => {
  chrome.storage.sync.set({ quality: sel.value });
});
