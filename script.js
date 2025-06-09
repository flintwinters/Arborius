// Global state variables for drag and tap interactions
let draggingCardElement = null; // Stores the HTML element currently being dragged
let draggingCardData = null;   // Stores the data object of the card being dragged
let offsetX, offsetY;          // Offset from the mouse/touch position to the card's top-left corner
let hoveredCardId = null;      // ID of the card currently hovered (for desktop 'f' key)
let draggedStack = [];         // Stores the entire stack of cards being dragged together

// Variables for tap/drag detection and timing
let startTime = 0;               // Timestamp when the current touch/click started
let initialTouchX = 0;           // X coordinate of touchstart
let initialTouchY = 0;           // Y coordinate of touchstart
let initialTouchTargetId = null; // ID of the element that started the touch
let isDragging = false;          // True if significant movement detected (drag active for card)
let isTapCandidate = false;      // True if touchstart occurred and no significant movement yet
let longPressTimer = null;       // Timer for long-press detection
let longPressTargetId = null;    // ID of the element targeted by a long-press
let lastTapTime = 0;             // Timestamp of the last tap (for double-tap)
let lastTapTargetId = null;      // ID of the element last tapped

// View offset for panning
let viewOffsetX = 0;
let viewOffsetY = 0;

// Background dragging state
let isBackgroundDragging = false; // True when dragging the background
let lastBackgroundDragX = 0;    // Last mouse X position during background drag
let lastBackgroundDragY = 0;    // Last mouse Y position during background drag

// Grid scaling variables
let gridSize = 130; // The size of the grid cells for snapping (in pixels) - now a variable
const MIN_GRID_SIZE = 50; // Minimum grid size
const MAX_GRID_SIZE = 250; // Maximum grid size
const ZOOM_SPEED = 0.1; // How much to change grid size per scroll delta

// Constants for card sizing, and interaction timings
const CARD_SIZE = 120; // Actual size of the card based on w-24 h-24 Tailwind classes (96px)
const Z_OFFSET_DISPLAY = 10; // The pixel offset for display per z-level
const LONG_PRESS_DURATION = 500;
const DOUBLE_TAP_DURATION = 300;
const MOVEMENT_THRESHOLD_FOR_DRAG = 10;

// Data storage for cards
let csvTextData = "";
let jsonReplacementsText = {};
const csvUrl = "https://arborius.online/card/arborius.csv";
const cardTemplates = {}; // Stores CSV row data by card name
const cardNames = [];     // List of card names from CSV

// Array to store card data objects
let cardsData = [];

// WebSocket connection
let ws = null;

/**
 * Escapes HTML characters in a string to prevent XSS.
 * @param {string} text - The input string to escape.
 * @returns {string} The escaped string.
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}
/**
 * Sends a signal to the WebSocket server to update the game state.
 */
function updateCardSignal() {
    ws.send(JSON.stringify({
        type: 'gamestate',
        count: cardIdCounter,
        data: JSON.stringify(cardsData.map(card => card.stringify()))
    }));
}

/**
 * Processes a file content string by applying a list of replacements.
 * @param {string} fileContent - The content string to process.
 * @param {Array<Array<string>>} replacements - An array of [search_string, replacement_string] pairs.
 * @returns {string} The processed string with replacements applied and HTML escaped."
 */
function showfileText(fileContent, replacements) {
    let ftxt = fileContent;
    
    if (!Array.isArray(replacements)) {
        console.warn("Expected replacements to be an array from the provided JSON string.");
        replacements = []; // Reset to empty array to prevent further errors
    }
    
    for (const rep of replacements) {
        const search = rep[0];
        const replacement = `<span style="font-size: 170%;">`+rep[1]+`</span>`;

        if (search[0] !== ',') {
            if (search === "adj") {
                ftxt = ftxt.replaceAll(search, replacement);
            } else if (replacement !== "img") {
                ftxt = ftxt.replaceAll(search, `${replacement}`);
            } else { // replacement is "img"
                ftxt = ftxt.replaceAll(search, "");
            }
        } else {
            ftxt = ftxt.replaceAll(search, replacement);
        }
    }
    return ftxt;
}

/**
 * Fetches CSV and JSON replacement data, then populates cardTemplates and cardNames.
 * Also initializes the card creation dropdown.
 */
async function fetchCardData() {
    try {
        const [csvResponse, jsonReplacementsResponse] = await Promise.all([
            fetch(csvUrl),
            fetch("https://arborius.online/card/arborius.json")
        ]);

        if (!csvResponse.ok) {
            throw new Error(`HTTP error! status: ${csvResponse.status} for CSV.`);
        }
        if (!jsonReplacementsResponse.ok) {
            throw new Error(`HTTP error! status: ${jsonReplacementsResponse.status} for JSON replacements.`);
        }

        const tempCsvTextData = await csvResponse.text();
        jsonReplacementsText = await jsonReplacementsResponse.text();
		console.log(jsonReplacementsText);
        csvTextData = showfileText(tempCsvTextData, JSON.parse(jsonReplacementsText));

        if (csvTextData) {
            const rows = csvTextData.split('\n').filter(row => row.trim() !== '');
            const dataRows = rows.slice(1); // Skip header row
            
            dataRows.forEach(row => {
                const name = row.split(",")[0];
                cardTemplates[name] = row;
                cardNames.push(name);
            });
            console.log("Card templates populated:", Object.keys(cardTemplates).length, "cards");
        }
        
    } catch (error) {
        console.error("Error fetching or parsing card data:", error);
    }

    // Populate dropdown with card creation options
    const tileDropdown = document.getElementById('list');
    cardNames.forEach(text => {
        const item = document.createElement('div');
        item.textContent = text;
        item.onclick = () => {
            const newCard = processCsvRow(cardTemplates[text]);
            if (newCard) {
                cardsData.push(newCard);
                renderCards();
                updateCardSignal();
            }
        };
        tileDropdown.appendChild(item);
    });
}

let cardIdCounter = 0; // Unique ID counter for card instances

/**
 * Factory function to create a new card object.
 * @param {string} typeId - Identifier for the card type.
 * @param {string} name - Display name of the card.
 * @param {number} cost - Mana/resource cost.
 * @param {string} borderColor - Hex color string for border.
 * @param {string} imgUrl - URL for the card's image.
 * @param {string} trigger - Description of when the card's ability triggers.
 * @param {string} ability - Description of the card's ability.
 * @param {number} gridX - Initial X coordinate on the grid.
 * @param {number} gridY - Initial Y coordinate on the grid.
 * @param {number} z - Initial Z coordinate (for stacking).
 * @param {string} color - Hex color string for background.
 * @param {number} [rotation=0] - Initial rotation in degrees.
 * @param {boolean} [isGrayedOut=false] - Initial grayed out state.
 * @param {boolean} [isMarker=false] - Indicates if the card is a marker.
 * @returns {object} The new card object.
 */
function makeCard(typeId, name, cost, borderColor, imgUrl, trigger, ability, gridX, gridY, z, color, rotation = 0, isGrayedOut = false, isMarker = false) {
    const card = {
        uuid: cardIdCounter++, // Unique ID for this specific card instance
        typeId: typeId,
        name: name,
        cost: cost,
        borderColor: borderColor,
        imgUrl: imgUrl,
        trigger: trigger,
        ability: ability,
        gridX: gridX,
        gridY: gridY,
        z: z,
        color: color,
        isGrayedOut: isGrayedOut,
        isMarker: isMarker,
        rotation: rotation,
        
        // Method to serialize the card object
        stringify: function() {
            const serializableCard = { ...this };
            delete serializableCard.tempPixelX; // Remove temporary display properties
            delete serializableCard.tempPixelY;
            delete serializableCard.stringify;   // Remove the function itself
            return JSON.stringify(serializableCard);
        }
    };
    return card;
}

/**
 * Processes a single CSV row and creates a new card object.
 * @param {string} csvRow - A single row string from the CSV.
 * @returns {object|null} A new card object or null if parsing fails.
 */
function processCsvRow(csvRow) {
    const parts = csvRow.split(',');
    
    if (parts.length < 5) {
        console.error("Invalid CSV row format. Expected at least 5 parts, got:", parts.length, csvRow);
        return null;
    }
    
    const name = parts[0];
    const cost = parseInt(parts[1], 10);
    const trigger = parts[2];
    const ability = parts[3];
    const imgUrl = parts[4];
    
    if (isNaN(cost)) {
        console.error("Invalid cost in CSV row:", parts[1], csvRow);
        return null;
    }
    
    const defaultTypeId = 'csv-card';
    const defaultBorderColor = '#888';
    const defaultGridX = 0;
    const defaultGridY = 2;
    const defaultZ = 0;
    const defaultColor = '#aaa';
    
    return makeCard(defaultTypeId, name, cost, defaultBorderColor, imgUrl, trigger, ability, defaultGridX, defaultGridY, defaultZ, defaultColor);
}

/**
 * Creates the HTML div element for a given card data object.
 * @param {object} cardData - The data object for the card.
 * @returns {HTMLElement} The newly created div element.
 */
function makeCardHtml(cardData) {
    const div = document.createElement('div');
    div.id = cardData.uuid;
    div.className = `draggable-card`;
    
    div.style.borderWidth = '2px';
    div.style.backgroundColor = cardData.isGrayedOut ? '#288' : cardData.borderColor;
    
    const img = document.createElement('img');
    img.src = "https://arborius.online/card/" + cardData.imgUrl;
    img.alt = cardData.name;
    img.className = 'card-image';
    img.ondragstart = () => false; // Prevent image dragging
    div.appendChild(img);
    
    const overlayDiv = document.createElement('div');
    overlayDiv.className = 'card-overlay';
    div.appendChild(overlayDiv);
    
    const costSpan = document.createElement('span');
    costSpan.className = 'card-cost';
    costSpan.textContent = cardData.cost;
    div.appendChild(costSpan);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'card-content';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'card-name';
    nameSpan.textContent = cardData.name;
    contentDiv.appendChild(nameSpan);
    
    const bottomInfoDiv = document.createElement('div');
    bottomInfoDiv.className = 'card-bottom-info';
    
    const triggerSpan = document.createElement('span');
    triggerSpan.className = 'trigger';
    triggerSpan.innerHTML = cardData.trigger;
    bottomInfoDiv.appendChild(triggerSpan);
    
    const triggerArrowDiv = document.createElement('div');
    triggerArrowDiv.className = 'triggerarrow';
    bottomInfoDiv.appendChild(triggerArrowDiv);
    
    const abilitySpan = document.createElement('span');
    abilitySpan.className = 'ability';
    abilitySpan.innerHTML = cardData.ability;
    bottomInfoDiv.appendChild(abilitySpan);
    
    contentDiv.appendChild(bottomInfoDiv);
    div.appendChild(contentDiv);
    
    return div;
}

/**
 * Updates the display properties (position, z-index, color, rotation, and scale) of a card's HTML element.
 * @param {HTMLElement} cardElement - The HTML element of the card.
 * @param {object} cardData - The data object for the card.
 * @param {number} currentViewOffsetX - The current X offset of the view.
 * @param {number} currentViewOffsetY - The current Y offset of the view.
 */
function displayCard(cardElement, cardData, currentViewOffsetX = 0, currentViewOffsetY = 0) {
    // Calculate pixel position from grid coordinates using current gridSize
    const pixelX = cardData.gridX * gridSize;
    const pixelY = cardData.gridY * gridSize;
    
    // Calculate the visual scale factor for the card
    // This makes the card appear larger/smaller as gridSize changes,
    // while CARD_SIZE (the base HTML element size) remains constant.
    const visualScale = gridSize / CARD_SIZE;

    // Apply z-offset for visual depth (fixed pixel value) AND current view offsets
    const displayX = pixelX - (cardData.z * Z_OFFSET_DISPLAY) + currentViewOffsetX;
    const displayY = pixelY - (cardData.z * Z_OFFSET_DISPLAY) + currentViewOffsetY;
    
    cardElement.style.left = `${displayX}px`;
    cardElement.style.top = `${displayY}px`;
    cardElement.style.zIndex = cardData.z;
    
    // Combine scaling and rotation transforms
    cardElement.style.transform = `scale(${visualScale}) rotate(${cardData.rotation}deg)`;
    cardElement.style.transformOrigin = 'center'; // Ensure scaling is from the center
    
    cardElement.style.backgroundColor = cardData.isGrayedOut ? '#288' : cardData.color;
    cardElement.style.opacity = cardData.isMarker ? ".4" : "1"; 
    cardElement.style.borderColor = cardData.isMarker ? "#0000" : "#fff";
    
    const bottomInfoDiv = cardElement.querySelector('.card-bottom-info');
    if (bottomInfoDiv) {
        bottomInfoDiv.style.display = cardData.isMarker ? 'none' : '';
    }
    const costDiv = cardElement.querySelector('.card-cost');
    if (costDiv) {
        costDiv.style.display = cardData.isMarker ? 'none' : '';
    }
}

/**
 * Renders all cards based on the cardsData array.
 * This function is called on load and after any data updates.
 */
function renderCards() {
    const body = document.body;
    
    document.querySelectorAll('.draggable-card').forEach(el => el.remove());
    
    // Sort cards by z-index to ensure correct rendering order (lower z-index appears underneath)
    const sortedCards = [...cardsData].sort((a, b) => a.z - b.z);
    
    sortedCards.forEach(card => {
        const div = makeCardHtml(card);
        displayCard(div, card, viewOffsetX, viewOffsetY); // Pass current global view offsets
        
        // These listeners are added here because cards are re-rendered
        // The global mouse down/up/move listeners will determine if it's a card drag or background pan
        div.addEventListener('mouseover', () => { hoveredCardId = card.uuid; });
        div.addEventListener('mouseout', () => { hoveredCardId = null; });
        
        body.appendChild(div);
    });
}

/**
 * Resets all global state variables related to drag/tap interactions.
 */
function resetInteractionState() {
    draggingCardElement = null;
    draggingCardData = null;
    offsetX = 0;
    offsetY = 0;
    longPressTimer = null;
    longPressTargetId = null;
    lastTapTime = 0;
    lastTapTargetId = null;
    startTime = 0;
    initialTouchX = 0;
    initialTouchY = 0;
    initialTouchTargetId = null;
    isDragging = false;
    isTapCandidate = false;
    draggedStack = [];
    isBackgroundDragging = false; // Reset background drag state
    lastBackgroundDragX = 0;
    lastBackgroundDragY = 0;
    // Ensure text selection is re-enabled when interaction state is reset
    document.body.style.userSelect = ''; 
}

/**
 * Handles the start of a drag operation for a card (mousedown or touchstart directly on a card).
 * This is called by `handleGlobalMouseDown` if the click target is a card.
 * @param {MouseEvent|TouchEvent} e - The event object.
 */
function startCardDrag(e) {
    const targetCard = e.target.closest('.draggable-card');
    if (!targetCard) return; // Should not happen if called correctly

    draggingCardElement = targetCard;
    draggingCardData = cardsData.find(c => c.uuid == draggingCardElement.id);
    
    if (!draggingCardData) return;
    
    // Record start time and initial touch/mouse position
    startTime = new Date().getTime();
    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    initialTouchX = clientX;
    initialTouchY = clientY;
    initialTouchTargetId = draggingCardElement.id;
    
    // Clear any existing long press timer if a new interaction starts
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        longPressTargetId = null;
    }
    
    // --- Touch-specific logic (double-tap, long-press, tap candidate) ---
    if (e.type === 'touchstart') {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTapTime;
        
        // 1. Double-tap check
        if (lastTapTargetId == draggingCardElement.id && tapLength < DOUBLE_TAP_DURATION) {
            toggleCardGrayState(draggingCardElement.id);
            lastTapTime = 0; // Reset for next tap
            lastTapTargetId = null;
            e.preventDefault(); // Prevent default browser behavior (like scrolling)
            resetInteractionState(); // Double-tap handled, reset state
            return; // Exit startCardDrag
        } else {
            lastTapTime = currentTime;
            lastTapTargetId = draggingCardElement.id;
        }
        
        // 2. Long-press setup (if not a double-tap)
        longPressTargetId = draggingCardElement.id;
        longPressTimer = setTimeout(() => {
            if (longPressTargetId == draggingCardElement.id && !isDragging) {
                toggleCardGrayState(longPressTargetId);
            }
            longPressTimer = null;
            longPressTargetId = null;
            isTapCandidate = false; // Long press consumed the tap candidate
        }, LONG_PRESS_DURATION);
        
        isTapCandidate = true; // Mark as potential tap for single-tap rotation
    } else { // It's a mousedown event
        isTapCandidate = false;
    }
    
    // --- Drag initiation preparation ---
    isDragging = false; // Assume not dragging initially
    
    draggingCardElement.classList.add('dragging');
    draggingCardElement.style.zIndex = 1000;
    
    // Calculate the current visual scale of the card
    const visualScale = gridSize / CARD_SIZE;
    // Calculate the offset from the mouse pointer to the top-left corner of the card
    // such that the card's center aligns with the mouse.
    offsetX = (CARD_SIZE * visualScale) / 2;
    offsetY = (CARD_SIZE * visualScale) / 2;

    // Calculate the card's initial "world" position (top-left, before view offset and z-offset)
    // We want to store where the card *would* be in grid coordinates if the view offset was zero.
    // The current mouse position minus the new offset gives us the desired top-left displayed position.
    const initialDisplayedX = clientX - offsetX;
    const initialDisplayedY = clientY - offsetY;

    // Convert this displayed position back to "world" coordinates (relative to 0,0 grid origin)
    // by subtracting the view offset and accounting for the z-offset
    draggingCardData.tempPixelX = initialDisplayedX - viewOffsetX + (draggingCardData.z * Z_OFFSET_DISPLAY);
    draggingCardData.tempPixelY = initialDisplayedY - viewOffsetY + (draggingCardData.z * Z_OFFSET_DISPLAY);

    // Apply the initial visual position immediately
    draggingCardElement.style.left = `${initialDisplayedX}px`;
    draggingCardElement.style.top = `${initialDisplayedY}px`;
    
    draggedStack = [];
    draggedStack.push({
        cardData: draggingCardData,
        element: draggingCardElement,
        initialPixelX: draggingCardData.tempPixelX,
        initialPixelY: draggingCardData.tempPixelY,
        initialZ: draggingCardData.z
    });
    
    // Find and include other cards in the same grid space with greater Z
    const currentGridX = draggingCardData.gridX;
    const currentGridY = draggingCardData.gridY;
    
    cardsData.forEach(c => {
        if (c.uuid == draggingCardData.uuid) return;
        
        if (c.gridX === currentGridX && c.gridY === currentGridY && c.z > draggingCardData.z) {
            const stackedElement = document.getElementById(c.uuid);
            if (stackedElement) {
                const stackedRect = stackedElement.getBoundingClientRect();
                // Store initial raw "world" pixel positions for stacked cards
                c.tempPixelX = stackedRect.left - viewOffsetX + (c.z * Z_OFFSET_DISPLAY);
                c.tempPixelY = stackedRect.top - viewOffsetY + (c.z * Z_OFFSET_DISPLAY);
                
                draggedStack.push({
                    cardData: c,
                    element: stackedElement,
                    initialPixelX: c.tempPixelX,
                    initialPixelY: c.tempPixelY,
                    initialZ: c.z
                });
                stackedElement.classList.add('dragging');
                stackedElement.style.zIndex = 1000;
            }
        }
    });
    
    if (e.type === 'touchstart') {
        e.preventDefault();
    }
}


/**
 * Global handler for mouse/touch down events. Determines if it's a card drag or background pan.
 * @param {MouseEvent|TouchEvent} e - The event object.
 */
function handleGlobalMouseDown(e) {
    const targetCard = e.target.closest('.draggable-card');
    
    if (targetCard) {
        // Clicked on a card, initiate card drag
        startCardDrag(e);
    } else {
        // Clicked on the background, initiate background pan
        isBackgroundDragging = true;
        lastBackgroundDragX = e.clientX;
        lastBackgroundDragY = e.clientY;
    }
}

/**
 * Global handler for mouse/touch move events.
 * Updates the position of either the dragging card or the view offset.
 * @param {MouseEvent|TouchEvent} e - The event object.
 */
/**
 * Global handler for mouse/touch down events. Determines if it's a card drag or background pan.
 * @param {MouseEvent|TouchEvent} e - The event object.
 */
function handleGlobalMouseDown(e) {
    // Check if the event target is within any UI element that should have normal behavior
    const isUIElement = e.target.closest('#menu-bar') || 
                       e.target.closest('input') || 
                       e.target.closest('button') || 
                       e.target.closest('form') ||
                       e.target.closest('.tab') ||
                       e.target.tagName === 'INPUT' ||
                       e.target.tagName === 'BUTTON' ||
                       e.target.tagName === 'SELECT' ||
                       e.target.tagName === 'TEXTAREA';
    
    // If clicking on UI elements, don't interfere - let default behavior happen
    if (isUIElement) {
        return;
    }
    
    const targetCard = e.target.closest('.draggable-card');
    
    if (targetCard) {
        // Clicked on a card, initiate card drag
        startCardDrag(e);
    } else {
        // Clicked on the background, initiate background pan
        isBackgroundDragging = true;
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        lastBackgroundDragX = clientX;
        lastBackgroundDragY = clientY;
        document.body.style.userSelect = 'none'; // Disable text selection only during background drag
        e.preventDefault(); // Prevent default browser drag behavior on background
    }
}

/**
 * Global handler for mouse/touch move events.
 * Updates the position of either the dragging card or the view offset.
 * @param {MouseEvent|TouchEvent} e - The event object.
 */
function handleGlobalMouseMove(e) {
    // Only handle movement if we're actually dragging something
    if (!isBackgroundDragging && !draggingCardElement) {
        return;
    }
    
    if (isBackgroundDragging) {
        const currentMouseX = e.clientX || (e.touches && e.touches[0].clientX);
        const currentMouseY = e.clientY || (e.touches && e.touches[0].clientY);

        const deltaX = currentMouseX - lastBackgroundDragX;
        const deltaY = currentMouseY - lastBackgroundDragY;

        viewOffsetX += deltaX;
        viewOffsetY += deltaY;

        lastBackgroundDragX = currentMouseX;
        lastBackgroundDragY = currentMouseY;

        renderCards(); // Re-render all cards with the new view offset
        e.preventDefault(); // Prevent default browser scrolling
    } else if (draggingCardElement) { // If a card is being dragged
        // Clear long press timer if movement occurs during potential tap/drag
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
            longPressTargetId = null;
        }
        
        // If movement is detected, it's a drag, not a tap
        if (isTapCandidate) {
            const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
            const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
            const distance = Math.sqrt(
                Math.pow(clientX - initialTouchX, 2) +
                Math.pow(clientY - initialTouchY, 2)
            );
            if (distance > MOVEMENT_THRESHOLD_FOR_DRAG) {
                isTapCandidate = false;
                isDragging = true;
            }
        }

        // Card-specific drag logic (follows mouse directly)
        const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

        // Calculate the new top-left displayed position of the card element
        // by subtracting the pre-calculated offset (which centers the card)
        let newDisplayedX = clientX - offsetX;
        let newDisplayedY = clientY - offsetY;

        // Update main card's DOM element position immediately for smooth visual drag
        draggingCardElement.style.left = `${newDisplayedX}px`;
        draggingCardElement.style.top = `${newDisplayedY}px`;

        // Update the card's *true* pixel position (relative to grid origin, without view offset)
        // This involves reversing the display calculation.
        draggingCardData.tempPixelX = newDisplayedX - viewOffsetX + (draggingCardData.z * Z_OFFSET_DISPLAY);
        draggingCardData.tempPixelY = newDisplayedY - viewOffsetY + (draggingCardData.z * Z_OFFSET_DISPLAY);

        // Move stacked cards relative to the main dragged card
        const mainCardInitialPixelX = draggedStack[0].initialPixelX; // This is a "world" coordinate
        const mainCardInitialPixelY = draggedStack[0].initialPixelY;

        const deltaWorldX = draggingCardData.tempPixelX - mainCardInitialPixelX;
        const deltaWorldY = draggingCardData.tempPixelY - mainCardInitialPixelY;

        for (let i = 1; i < draggedStack.length; i++) {
            const stackedItem = draggedStack[i];
            const stackedCardData = stackedItem.cardData;
            const stackedElement = stackedItem.element;

            let newStackedWorldX = stackedItem.initialPixelX + deltaWorldX;
            let newStackedWorldY = stackedItem.initialPixelY + deltaWorldY;

            // Apply new position to stacked card's DOM element, converting world to display
            let newStackedDisplayedX = newStackedWorldX - (stackedCardData.z * Z_OFFSET_DISPLAY) + viewOffsetX;
            let newStackedDisplayedY = newStackedWorldY - (stackedCardData.z * Z_OFFSET_DISPLAY) + viewOffsetY;

            stackedCardData.tempPixelX = newStackedDisplayedX - viewOffsetX + (stackedCardData.z * Z_OFFSET_DISPLAY);
            stackedCardData.tempPixelY = newStackedDisplayedY - viewOffsetY + (stackedCardData.z * Z_OFFSET_DISPLAY);

            stackedElement.style.left = `${newStackedDisplayedX}px`;
            stackedElement.style.top = `${newStackedDisplayedY}px`;
        }
        if (e.type === 'touchmove') {
            e.preventDefault(); // Prevent page scrolling during card drag
        }
    }
}

/**
 * Global handler for mouse/touch up events. Ends drag or handles tap.
 * @param {MouseEvent|TouchEvent} e - The event object.
 */
function handleGlobalMouseUp(e) {
    // If a background drag was active, end it and reset interaction state
    if (isBackgroundDragging) {
        isBackgroundDragging = false;
        document.body.style.userSelect = ''; // Re-enable text selection
        resetInteractionState(); // Reset all drag-related states including card trackers
        return; // Exit, as this was a background drag ending
    }
    
    // Only proceed with card-specific end logic if a card was being dragged or tapped
    if (!draggingCardElement || !draggingCardData) {
        resetInteractionState();
        return;
    }
    
    // If a long press timer was active, clear it as interaction ended
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        longPressTargetId = null;
    }
    
    const currentClientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const currentClientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    
    const distanceMoved = Math.sqrt(
        Math.pow(currentClientX - initialTouchX, 2) +
        Math.pow(currentClientY - initialTouchY, 2)
    );
    const tapDuration = new Date().getTime() - startTime;
    
    // --- Mobile Tap Rotation Logic ---
    if (e.type === 'touchend' && isTapCandidate && !isDragging && tapDuration < DOUBLE_TAP_DURATION && distanceMoved < MOVEMENT_THRESHOLD_FOR_DRAG) {
        if (initialTouchTargetId == draggingCardElement.id) {
            const rect = draggingCardElement.getBoundingClientRect();
            const tapX = currentClientX - rect.left;
            const cardWidth = rect.width;
            
            if (tapX > cardWidth / 2) {
                rotateCardCW(draggingCardElement.id);
            } else {
                rotateCardCCW(draggingCardElement.id);
            }
        }
        resetInteractionState();
        return; // Tap handled, exit handleGlobalMouseUp
    }
    
    // If we reached here, it was either a significant card drag, or a non-tap mouse click/release.
    // Calculate the snapped grid position for the main dragged card using tempPixelX/Y (world coordinates)
    let snappedGridX = Math.round(draggingCardData.tempPixelX / gridSize);
    let snappedGridY = Math.round(draggingCardData.tempPixelY / gridSize);
    
    let snappedPixelX = snappedGridX * gridSize;
    let snappedPixelY = snappedGridY * gridSize;
    
    // Update main card's grid position
    draggingCardData.gridX = Math.round(snappedPixelX / gridSize);
    draggingCardData.gridY = Math.round(snappedPixelY / gridSize);
    
    // Determine new Z for the main dragged card
    let maxZAtNewLocation = -1;
    cardsData.forEach(c => {
        const isPartOfDraggedStack = draggedStack.some(item => item.cardData.uuid == c.uuid);
        if (isPartOfDraggedStack) {
            return;
        }
        
        if (c.gridX === draggingCardData.gridX && c.gridY === draggingCardData.gridY) {
            if (c.z > maxZAtNewLocation) {
                maxZAtNewLocation = c.z;
            }
        }
    });
    
    const originalMainZ = draggedStack[0].initialZ;
    const newMainZ = maxZAtNewLocation + 1;
    const zDifference = newMainZ - originalMainZ;
    
    draggingCardData.z = newMainZ;
    
    // Update positions and Z for all cards in the dragged stack
    draggedStack.forEach(stackedItem => {
        const stackedCardData = stackedItem.cardData;
        stackedCardData.gridX = draggingCardData.gridX;
        stackedCardData.gridY = draggingCardData.gridY;
        stackedCardData.z = stackedItem.initialZ + zDifference;
    });
    
    renderCards(); // Re-render to apply all final positions and Z-indices
    updateCardSignal();
    
    resetInteractionState();
}

/**
 * Toggles the 'isGrayedOut' state of a card and re-renders the cards.
 * @param {string} cardUuid - The UUID of the card to toggle.
 */
function toggleCardGrayState(cardUuid) {
    const targetCard = cardsData.find(c => c.uuid == cardUuid);
    if (targetCard) {
        targetCard.isGrayedOut = !targetCard.isGrayedOut;
        renderCards();
        updateCardSignal();
    }
}

/**
 * Toggles the 'isMarker' state of a card and re-renders the cards.
 * @param {string} cardUuid - The UUID of the card to toggle.
 */
function toggleIsMarker(cardUuid) {
    const targetCard = cardsData.find(c => c.uuid == cardUuid);
    if (targetCard) {
        targetCard.isMarker = !targetCard.isMarker;
        renderCards();
        updateCardSignal();
    }
}

/**
 * Rotates a card clockwise by 90 degrees and re-renders.
 * @param {string} cardUuid - The UUID of the card to rotate.
 */
function rotateCardCW(cardUuid) {
    const targetCard = cardsData.find(c => c.uuid == cardUuid);
    if (targetCard) {
        targetCard.rotation = (targetCard.rotation + 90) % 360;
        renderCards();
        updateCardSignal();
    }
}

/**
 * Rotates a card counter-clockwise by 90 degrees and re-renders.
 * @param {string} cardUuid - The UUID of the card to rotate.
 */
function rotateCardCCW(cardUuid) {
    const targetCard = cardsData.find(c => c.uuid == cardUuid);
    if (targetCard) {
        targetCard.rotation = (targetCard.rotation - 90 + 360) % 360;
        renderCards();
        updateCardSignal();
    }
}

/**
 * Handles keyboard events for card manipulation. WASD panning removed.
 * @param {KeyboardEvent} e - The keyboard event object.
 */
function handleKeyboardEvent(e) {
    const isKeyDown = e.type === 'keydown';
    
    // Only handle card-specific keys on keydown if a card is hovered
    if (isKeyDown && hoveredCardId !== null) {
        const targetCard = cardsData.find(c => c.uuid == hoveredCardId);
        if (!targetCard) return;
        
        if (e.key === 'f') {
            toggleCardGrayState(hoveredCardId);
        } else if (e.key === 'm') {
            toggleIsMarker(hoveredCardId);
        } else if (e.key === 'q') {
            rotateCardCCW(hoveredCardId);
        } else if (e.key === 'e') {
            rotateCardCW(hoveredCardId);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            const indexToRemove = cardsData.findIndex(c => c.uuid == hoveredCardId);
            if (indexToRemove !== -1) {
                cardsData.splice(indexToRemove, 1);
                renderCards();
                updateCardSignal();
            }
        } else if (e.key === 'r') {
            if (targetCard.borderColor === '#3B82F6') {
                targetCard.borderColor = '#EF4444';
                targetCard.color = '#EF4444';
            } else {
                targetCard.borderColor = '#3B82F6';
                targetCard.color = '#3B82F6';
            }
            renderCards();
            updateCardSignal();
        }
    }
}

/**
 * Handles mouse wheel events for zooming (scaling the grid size) around the mouse pointer.
 * @param {WheelEvent} e - The wheel event object.
 */
function handleMouseWheel(e) {
    e.preventDefault(); // Prevent page scrolling
    
    const oldGridSize = gridSize; // Store the current gridSize before updating
    
    // Adjust gridSize based on scroll direction and ZOOM_SPEED
    gridSize += e.deltaY * -ZOOM_SPEED; // Negative deltaY means scroll up (zoom in)
    
    // Clamp gridSize within defined min/max values
    gridSize = Math.max(MIN_GRID_SIZE, Math.min(gridSize, MAX_GRID_SIZE));
    
    // Calculate the scale factor
    const scaleFactor = gridSize / oldGridSize;

    // Use the mouse's current position as the pivot point for zooming
    const pivotX = e.clientX;
    const pivotY = e.clientY;

    // Calculate the "world" coordinates that are currently at the pivot point
    const worldXAtPivot = pivotX - viewOffsetX;
    const worldYAtPivot = pivotY - viewOffsetY;

    // Calculate the new view offsets to keep the world point at the pivot point
    viewOffsetX = pivotX - (worldXAtPivot * scaleFactor);
    viewOffsetY = pivotY - (worldYAtPivot * scaleFactor);
    
    renderCards(); // Re-render all cards with the new gridSize and adjusted view offsets
}


function handleCreateRoom(event) {
    event.preventDefault();
    createRoom();
}

function createRoom() {
    const name = document.getElementById("newRoomName").value.trim();
    document.getElementById("newRoomName").value = "";
    if (name) {
        ws.send(JSON.stringify({
            type: "create_room",
            room: name,
        }));
    }
}

/**
 * Parses a card JSON string and re-attaches the stringify method.
 * @param {string} cardJson - The JSON string representation of a card.
 * @returns {object} The parsed card object with the stringify method.
 */
function parseCard(cardJson) {
    const card = JSON.parse(cardJson);
    // Re-add the stringify method to the reconstructed card object
    card.stringify = function() {
        const serializableCard = { ...this };
        delete serializableCard.tempPixelX;
        delete serializableCard.tempPixelY;
        delete serializableCard.stringify;
        return JSON.stringify(serializableCard);
    };
    return card;
}

/**
 * Handles incoming WebSocket messages, parsing them and directing to appropriate logic.
 * @param {MessageEvent} event - The WebSocket message event.
 */
function handleWebSocketMessage(event) {
    const message = JSON.parse(event.data);
    if (message.type === 'gamestate') {
        console.log('Received gamestate message');
        document.querySelectorAll('.draggable-card').forEach(el => el.remove());
        cardsData = JSON.parse(message.data).map(parseCard);
        cardIdCounter = message.count; // Use cardIdCounter here
        renderCards();
    } else if (message.type === 'createcard') {
        console.log('Received createcard message:', message);
        const newCardProps = parseCard(message.data);
        const newCard = makeCard(
            newCardProps.typeId,
            newCardProps.name,
            newCardProps.cost,
            newCardProps.borderColor,
            newCardProps.imgUrl,
            newCardProps.trigger,
            newCardProps.ability,
            newCardProps.gridX,
            newCardProps.gridY,
            newCardProps.z,
            newCardProps.color,
            newCardProps.rotation,
            newCardProps.isGrayedOut,
            newCardProps.isMarker // Ensure isMarker is also passed
        );
        cardsData.push(newCard);
        renderCards();
    } else if (message.type === 'destroycard') {
        const destroyedCardUuid = message.data;
        const indexToRemove = cardsData.findIndex(c => c.uuid == destroyedCardUuid);
        if (indexToRemove !== -1) {
            cardsData.splice(indexToRemove, 1);
            renderCards();
        }
    } else if (message.type === "rooms") {
        const navbar = document.getElementById("navbar");
        navbar.innerHTML = "";
        message.rooms.forEach(room => {
            const tab = document.createElement("div");
            tab.className = "tab";
            tab.textContent = room.name;
            tab.onclick = () => {
                ws.send(JSON.stringify({ type: "sync", room: room.name }));
            };
            navbar.appendChild(tab);
        });
    } else if (message.type === "room_created") {
        ws.send(JSON.stringify({ type: "get_rooms" }));
    }
}

let reconnectTimeout = 1000;

setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) { // Add null check for ws
        ws.send(JSON.stringify({ type: "ping" }));
    }
}, 20000);

function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log("WebSocket is already open or connecting.");
        return;
    }
    
    ws = new WebSocket("wss://arborius.online");
    
    ws.onopen = () => {
        console.log("WebSocket connected");
        reconnectTimeout = 1000; // Reset reconnect timeout on successful connection
        ws.send(JSON.stringify({ type: "get_rooms" }));
    };
    
    ws.onmessage = handleWebSocketMessage;
    
    ws.onclose = (event) => {
        console.warn("WebSocket closed:", event.code, event.reason);
        attemptReconnect();
    };
    
    ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        // Do not call ws.close() here as it might lead to a loop with onclose calling attemptReconnect
    };
}

function attemptReconnect() {
    setTimeout(() => {
        console.log("Reconnecting WebSocket...");
        connectWebSocket();
    }, reconnectTimeout);
    reconnectTimeout = Math.min(reconnectTimeout * 2, 30000); // exponential backoff
}

// Initialize the application when the window loads
window.onload = async function() {
    await fetchCardData(); // Fetch CSV data before rendering cards
    renderCards(); // Initial render of cards
    
    connectWebSocket(); // Establish WebSocket connection

    // Attach global event listeners to the window for mouse/touch input
    window.addEventListener('mousedown', handleGlobalMouseDown);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchstart', handleGlobalMouseDown, { passive: false });
    window.addEventListener('touchmove', handleGlobalMouseMove, { passive: false });
    window.addEventListener('touchend', handleGlobalMouseUp);
    window.addEventListener('touchcancel', handleGlobalMouseUp);
    
    // Attach keydown/keyup event listeners for card manipulation (WASD removed for panning)
    window.addEventListener('keydown', handleKeyboardEvent);
    window.addEventListener('keyup', handleKeyboardEvent);

    // Attach mouse wheel event listener for zooming
    window.addEventListener('wheel', handleMouseWheel, { passive: false });

    // Start the game loop (no longer for panning, but could be for other animations)
    // requestAnimationFrame(gameLoop); // No longer needed for panning
};
