// background.js
let isActive = false;

chrome.action.onClicked.addListener((tab) => {
  isActive = !isActive;
  
  const iconState = isActive ? '-active' : '';
  chrome.action.setIcon({
    path: {
      "16": `icon16${iconState}.png`,
      "48": `icon48${iconState}.png`,
      "128": `icon128${iconState}.png`
    }
  });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });
});