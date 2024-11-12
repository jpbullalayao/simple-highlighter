const HIGHLIGHT_CLASS = 'chrome-extension-highlight';
const STORAGE_KEY = 'highlightedRanges';

// Enhanced style that preserves text layout
const style = document.createElement('style');
style.textContent = `
  .${HIGHLIGHT_CLASS} {
    position: relative;
    display: inline;
    /* Remove any padding/margins that might affect layout */
    padding: 0 !important;
    margin: 0 !important;
    /* Ensure the element doesn't change line height */
    line-height: inherit !important;
    /* Preserve original text color when background changes */
    color: inherit !important;
    /* Create a new stacking context */
    z-index: 1;
  }

  .${HIGHLIGHT_CLASS}::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    /* Extend slightly to cover full text height but stay within line */
    margin: -0.15em -0.05em;
    /* Place behind text */
    z-index: -1;
    /* Rounded corners */
    border-radius: 0.2em;
    /* Default highlight color, will be overridden by inline styles */
    background-color: rgba(255, 255, 0, 0.5);
  }

  .${HIGHLIGHT_CLASS}-delete {
    position: absolute;
    top: -0.8em;
    right: -0.8em;
    width: 1.6em;
    height: 1.6em;
    background: #ff4444;
    color: white;
    border-radius: 50%;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 0.75em;
    cursor: pointer;
    line-height: 1;
    font-family: Arial, sans-serif;
    /* Ensure delete button stays on top */
    z-index: 2;
    /* Remove any inherited styles */
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
  }

  /* Only show delete button on highlight hover */
  .${HIGHLIGHT_CLASS}:hover .${HIGHLIGHT_CLASS}-delete {
    display: flex;
  }
`;
document.head.appendChild(style);

// Color utilities
const getLuminance = (r, g, b) => {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

const getContrastRatio = (l1, l2) => {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

const getTextColor = (element) => {
  const style = window.getComputedStyle(element);
  const color = style.color;
  const rgb = color.match(/\d+/g).map(Number);
  return { rgb, luminance: getLuminance(...rgb) };
};

const getHighlightColors = (textColor) => {
  // Base highlight colors (with alpha for better text legibility)
  const highlightOptions = [
    { bg: [255, 255, 200, 0.5], text: textColor.rgb }, // light yellow bg, preserve text color
    { bg: [50, 50, 0, 0.7], text: [255, 255, 255] }    // dark yellow bg, white text
  ];

  const textLuminance = getLuminance(...textColor.rgb);
  
  return highlightOptions.reduce((best, current) => {
    const bgLuminance = getLuminance(...current.bg.slice(0, 3));
    const contrast = getContrastRatio(textLuminance, bgLuminance);
    
    if (!best || contrast > best.contrast) {
      return { ...current, contrast };
    }
    return best;
  }, null);
};

const createDeleteButton = () => {
  const deleteBtn = document.createElement('span');
  deleteBtn.className = `${HIGHLIGHT_CLASS}-delete`;
  deleteBtn.innerHTML = '×';
  deleteBtn.setAttribute('title', 'Remove highlight');
  return deleteBtn;
};

const highlightRange = (range, colors) => {
  const mark = document.createElement('mark');
  mark.className = HIGHLIGHT_CLASS;
  
  // Apply background color to pseudo-element via custom property
  const [r, g, b, a] = colors.bg;
  mark.style.setProperty('--highlight-color', `rgba(${r}, ${g}, ${b}, ${a})`);
  
  // Add delete button
  const deleteBtn = createDeleteButton();
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await removeHighlight(mark);
  });
  
  // Use try-catch to handle potential DOM exceptions
  try {
    range.surroundContents(mark);
    mark.appendChild(deleteBtn);
    
    // Apply highlight color through pseudo-element
    const style = document.createElement('style');
    const className = `${HIGHLIGHT_CLASS}-${Date.now()}`;
    mark.classList.add(className);
    style.textContent = `
      .${className}::before {
        background-color: rgba(${colors.bg.join(',')}) !important;
      }
    `;
    document.head.appendChild(style);
  } catch (error) {
    console.error('Error creating highlight:', error);
  }
};

const removeHighlight = async (highlightElement) => {
  try {
    const xpath = getXPathForNode(highlightElement);
    
    // Remove from storage
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const allHighlights = result[STORAGE_KEY] || {};
    const pageHighlights = allHighlights[window.location.href] || [];
    
    const updatedHighlights = pageHighlights.filter(h => h.xpath !== xpath);
    allHighlights[window.location.href] = updatedHighlights;
    await chrome.storage.local.set({ [STORAGE_KEY]: allHighlights });
    
    // Remove from DOM while preserving text
    const parent = highlightElement.parentNode;
    const text = highlightElement.childNodes[0]; // Get the text node
    parent.insertBefore(text, highlightElement);
    parent.removeChild(highlightElement);
  } catch (error) {
    console.error('Error removing highlight:', error);
  }
};

// Event listener for text selection
document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  if (!selection.toString()) return;

  const range = selection.getRangeAt(0);
  const textColor = getTextColor(range.startContainer.parentElement);
  const highlightColors = getHighlightColors(textColor);
  
  highlightRange(range, highlightColors);
  
  saveHighlight({
    xpath: getXPathForNode(range.startContainer),
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    colors: highlightColors
  });
});

// Load existing highlights
const loadSavedHighlights = async () => {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  const savedHighlights = result[STORAGE_KEY]?.[window.location.href] || [];
  
  savedHighlights.forEach(({ xpath, startOffset, endOffset, colors }) => {
    try {
      const node = getNodeFromXPath(xpath);
      if (node) {
        const range = document.createRange();
        range.setStart(node, startOffset);
        range.setEnd(node, endOffset);
        highlightRange(range, colors);
      }
    } catch (error) {
      console.error('Error restoring highlight:', error);
    }
  });
};

loadSavedHighlights();

// getXPathForNode and getNodeFromXPath functions remain the same
const getXPathForNode = (node) => {
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }
  
  if (node === document.body) {
    return '/html/body';
  }
  
  const buildPath = (currentNode) => {
    if (currentNode === document.body) {
      return '/html/body';
    }
    
    let pos = 1;
    let tempNode = currentNode;
    
    while (tempNode.previousSibling) {
      tempNode = tempNode.previousSibling;
      if (tempNode.nodeType === Node.ELEMENT_NODE && 
          tempNode.tagName === currentNode.tagName) {
        pos++;
      }
    }
    
    return `${buildPath(currentNode.parentNode)}/${currentNode.tagName.toLowerCase()}[${pos}]`;
  };
  
  return buildPath(node);
};

const getNodeFromXPath = (xpath) => {
  try {
    return document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
  } catch (error) {
    console.error('Error getting node from XPath:', error);
    return null;
  }
};