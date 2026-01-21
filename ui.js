import { GCodeGenerator } from './generator.js';

const generator = new GCodeGenerator();

// DOM Elements
const shapeSelect = document.getElementById('shapeSelect');
const originSelect = document.getElementById('originSelect');
const dimensionInputs = document.getElementById('dimensionInputs');
const stockWidthInput = document.getElementById('stockWidth');
const stockHeightInput = document.getElementById('stockHeight');
const gcodeOutput = document.getElementById('gcodeOutput');
const downloadBtn = document.getElementById('downloadBtn');
const canvas = document.getElementById('previewCanvas');
const ctx = canvas.getContext('2d');
const toolPreset = document.getElementById('toolPreset');
const saveToolBtn = document.getElementById('saveToolBtn');
const enableRapidCheckbox = document.getElementById('enableRapid');
const rapidXYInput = document.getElementById('rapidXY');
const rapidZInput = document.getElementById('rapidZ');
const stockThicknessInput = document.getElementById('stockThickness');
const targetDepthInput = document.getElementById('targetDepth');

// Tab DOM Elements
const enableTabsCheckbox = document.getElementById('enableTabs');
const tabWidthInput = document.getElementById('tabWidth');
const tabThicknessInput = document.getElementById('tabThickness');
const tabContainer = document.getElementById('tabContainer');
const tabList = document.getElementById('tabList');
const addTabBtn = document.getElementById('addTabBtn');

// Input IDs to track for changes
const inputs = [
    'toolDiameter', 'operation', 'targetDepth', 'passDepth', 
    'safeZ', 'spindleSpeed', 'feedRate', 'stockWidth', 'stockHeight',
    'enableRapid', 'rapidXY', 'rapidZ', 'stockThickness',
    'enableTabs', 'tabWidth', 'tabThickness'
];

// State
let tabs = [];

// Shape specific configurations
const shapeConfigs = {
    square: [{ id: 'width', label: 'Side Length (mm)', value: 50 }],
    rectangle: [
        { id: 'width', label: 'Width (mm)', value: 80 },
        { id: 'height', label: 'Height (mm)', value: 40 }
    ],
    circle: [{ id: 'diameter', label: 'Diameter (mm)', value: 50 }]
};

function init() {
    renderDimensions('square'); // Default
    loadToolLibrary();
    attachListeners();
    update();
}

function renderDimensions(shape) {
    dimensionInputs.innerHTML = '';
    const config = shapeConfigs[shape];
    
    config.forEach(field => {
        const div = document.createElement('div');
        div.innerHTML = `
            <label>
                ${field.label}
                <input type="number" id="${field.id}" value="${field.value}" step="1">
            </label>
        `;
        dimensionInputs.appendChild(div);
    });
    
    // Re-attach listeners to new inputs
    dimensionInputs.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', update);
    });
}

function attachListeners() {
    shapeSelect.addEventListener('change', (e) => {
        const newShape = e.target.value;
        const oldShapeParams = getParams(); // We can't know the previous shape easily unless we store it, but checking tabs is enough
        
        // Clear tabs if switching logic (Rect <-> Circle)
        const isRect = s => s === 'square' || s === 'rectangle';
        if (tabs.length > 0) {
            // If switching from Circle to Rect or vice-versa, clear tabs
            // Actually, just clear tabs on any shape change for safety/simplicity in this version
            // Or better: Preserve if compatible.
            // Check if existing tabs have 'angle' but new shape is rect...
            const hasAngle = tabs[0].angle !== undefined;
            const newIsRect = isRect(newShape);
            
            if ((hasAngle && newIsRect) || (!hasAngle && !newIsRect)) {
                tabs = [];
            }
        }

        renderDimensions(newShape);
        renderTabs();
        update();
    });
    
    originSelect.addEventListener('change', update);

    inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', update);
    });

    enableRapidCheckbox.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        rapidXYInput.disabled = !enabled;
        rapidZInput.disabled = !enabled;
        update();
    });

    stockThicknessInput.addEventListener('input', (e) => {
        const val = e.target.value;
        if (val) {
            targetDepthInput.value = val;
            update(); // Trigger update with new depth
        }
    });
    
    // Tab Listeners
    enableTabsCheckbox.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        tabWidthInput.disabled = !enabled;
        tabThicknessInput.disabled = !enabled;
        tabContainer.style.display = enabled ? 'block' : 'none';
        update();
    });

    addTabBtn.addEventListener('click', addTab);

    downloadBtn.addEventListener('click', downloadGCode);
    toolPreset.addEventListener('change', loadSelectedTool);
    saveToolBtn.addEventListener('click', saveToolPreset);
}

function addTab() {
    const shape = shapeSelect.value;
    if (shape === 'circle') {
        tabs.push({ angle: 0 });
    } else {
        tabs.push({ side: 'bottom', offset: 50 }); // 50%
    }
    renderTabs();
    update();
}

function removeTab(index) {
    tabs.splice(index, 1);
    renderTabs();
    update();
}

function updateTab(index, key, value) {
    tabs[index][key] = value;
    update();
}

function renderTabs() {
    tabList.innerHTML = '';
    const shape = shapeSelect.value;
    
    tabs.forEach((tab, index) => {
        const row = document.createElement('div');
        row.className = 'grid';
        row.style.marginBottom = '0.5rem';
        row.style.alignItems = 'center';

        if (shape === 'circle') {
            row.innerHTML = `
                <label>Angle (deg)
                    <input type="number" value="${tab.angle}" step="5" min="0" max="360" onchange="window.updateTab(${index}, 'angle', parseFloat(this.value))">
                </label>
            `;
        } else {
            row.innerHTML = `
                <label>Side
                    <select onchange="window.updateTab(${index}, 'side', this.value)">
                        <option value="bottom" ${tab.side === 'bottom' ? 'selected' : ''}>Bottom</option>
                        <option value="top" ${tab.side === 'top' ? 'selected' : ''}>Top</option>
                        <option value="left" ${tab.side === 'left' ? 'selected' : ''}>Left</option>
                        <option value="right" ${tab.side === 'right' ? 'selected' : ''}>Right</option>
                    </select>
                </label>
                <label>Pos (%)
                    <input type="number" value="${tab.offset}" step="5" min="0" max="100" onchange="window.updateTab(${index}, 'offset', parseFloat(this.value))">
                </label>
            `;
        }
        
        const delBtn = document.createElement('button');
        delBtn.textContent = '×';
        delBtn.className = 'outline contrast';
        delBtn.style.width = 'auto';
        delBtn.style.padding = '0.2rem 0.8rem';
        delBtn.onclick = () => removeTab(index);
        
        // Wrap button
        const btnDiv = document.createElement('div');
        btnDiv.appendChild(delBtn);
        row.appendChild(btnDiv);

        tabList.appendChild(row);
    });
}

// Expose helper to window for inline events
window.updateTab = updateTab;

function getParams() {
    const shape = shapeSelect.value;
    const params = {
        shape: shape,
        origin: originSelect.value,
        toolDiameter: parseFloat(document.getElementById('toolDiameter').value) || 0,
        operation: document.getElementById('operation').value,
        targetDepth: parseFloat(document.getElementById('targetDepth').value) || 0,
        passDepth: parseFloat(document.getElementById('passDepth').value) || 0,
        safeZ: parseFloat(document.getElementById('safeZ').value) || 0,
        spindleSpeed: parseFloat(document.getElementById('spindleSpeed').value) || 0,
        feedRate: parseFloat(document.getElementById('feedRate').value) || 0,
        enableRapid: enableRapidCheckbox.checked,
        rapidXY: parseFloat(rapidXYInput.value) || 0,
        rapidZ: parseFloat(rapidZInput.value) || 0,
        stockThickness: parseFloat(stockThicknessInput.value) || 0,
        // Tab Params
        enableTabs: enableTabsCheckbox.checked,
        tabWidth: parseFloat(tabWidthInput.value) || 0,
        tabThickness: parseFloat(tabThicknessInput.value) || 0,
        tabs: [...tabs] // Copy
    };

    // Add dynamic shape params
    if (shape === 'square') {
        params.width = parseFloat(document.getElementById('width').value) || 0;
        params.shapeWidth = params.width;
        params.shapeHeight = params.width;
    } else if (shape === 'rectangle') {
        params.width = parseFloat(document.getElementById('width').value) || 0;
        params.height = parseFloat(document.getElementById('height').value) || 0;
        params.shapeWidth = params.width;
        params.shapeHeight = params.height;
    } else if (shape === 'circle') {
        params.diameter = parseFloat(document.getElementById('diameter').value) || 0;
        params.shapeWidth = params.diameter;
        params.shapeHeight = params.diameter;
    }

    // Stock Params
    const userStockW = parseFloat(stockWidthInput.value) || 0;
    const userStockH = parseFloat(stockHeightInput.value) || 0;
    
    // Default to shape bounds if stock is smaller or not set
    params.stockWidth = userStockW > 0 ? userStockW : params.shapeWidth;
    params.stockHeight = userStockH > 0 ? userStockH : params.shapeHeight;

    return params;
}

function update() {
    const params = getParams();
    generator.setParams(params);
    
    // Generate Text
    const code = generator.generate();
    gcodeOutput.value = code;

    // Draw Preview
    drawPreview(params);
}

function drawPreview(params) {
    // Clear Canvas
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Dimensions
    const sw = params.stockWidth;
    const sh = params.stockHeight;
    
    // Scale calculation (fit STOCK + padding)
    const maxDim = Math.max(sw, sh) || 100;
    const scale = (Math.min(canvas.width, canvas.height) * 0.7) / maxDim;

    // Draw Stock (Centered at cx, cy)
    ctx.fillStyle = '#f0f0f0'; // Light gray
    ctx.strokeStyle = '#ccc';
    ctx.setLineDash([5, 5]);
    ctx.fillRect(cx - (sw/2 * scale), cy - (sh/2 * scale), sw * scale, sh * scale);
    ctx.strokeRect(cx - (sw/2 * scale), cy - (sh/2 * scale), sw * scale, sh * scale);
    ctx.setLineDash([]); // Reset dash

    // Calculate Origin Axis Position relative to Stock
    let axisX = cx;
    let axisY = cy;

    const originVal = params.origin || 'stock-center';
    let refW = sw;
    let refH = sh;
    
    let originPos = 'center';
    
    if (originVal.startsWith('shape-')) {
        refW = params.shapeWidth;
        refH = params.shapeHeight;
        originPos = originVal.replace('shape-', '');
    } else {
        // Assume stock
        refW = sw;
        refH = sh;
        originPos = originVal.replace('stock-', ''); // remove prefix if present
    }

    switch (originPos) {
        case 'bottom-left':
            axisX = cx - (refW / 2 * scale);
            axisY = cy + (refH / 2 * scale);
            break;
        case 'bottom-right':
            axisX = cx + (refW / 2 * scale);
            axisY = cy + (refH / 2 * scale);
            break;
        case 'top-left':
            axisX = cx - (refW / 2 * scale);
            axisY = cy - (refH / 2 * scale);
            break;
        case 'top-right':
            axisX = cx + (refW / 2 * scale);
            axisY = cy - (refH / 2 * scale);
            break;
        case 'center':
        default:
            // Centered
            break;
    }

    // Draw Grid/Axes (Origin)
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    
    // Draw Axes (Stronger)
    ctx.strokeStyle = '#ff0000'; // Red X
    ctx.beginPath();
    ctx.moveTo(0, axisY); ctx.lineTo(canvas.width, axisY); 
    ctx.stroke();

    ctx.strokeStyle = '#00ff00'; // Green Y
    ctx.beginPath();
    ctx.moveTo(axisX, 0); ctx.lineTo(axisX, canvas.height); 
    ctx.stroke();

    // Mark Origin (0,0)
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(axisX, axisY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Draw Shape (Centered in Stock -> Centered at cx, cy)
    let w = 0, h = 0, r = 0;
    if (params.shape === 'square') { w = params.width; h = params.width; }
    if (params.shape === 'rectangle') { w = params.width; h = params.height; }
    if (params.shape === 'circle') { r = params.diameter / 2; w = params.diameter; h = params.diameter; }

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (params.shape === 'circle') {
        ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
    } else {
        ctx.rect(cx - (w/2 * scale), cy - (h/2 * scale), w * scale, h * scale);
    }
    ctx.stroke();

    // Draw Toolpath (Red Dashed)
    let offset = 0;
    if (params.operation === 'outside') offset = params.toolDiameter / 2;
    if (params.operation === 'inside') offset = -params.toolDiameter / 2;

    ctx.strokeStyle = '#0000ff'; // Blue toolpath
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    
    if (params.shape === 'circle') {
        const pathR = r + offset;
        if (pathR > 0) ctx.arc(cx, cy, pathR * scale, 0, Math.PI * 2);
    } else {
        const pathW = w + (offset * 2);
        const pathH = h + (offset * 2);
        if (pathW > 0 && pathH > 0) {
            ctx.rect(cx - (pathW/2 * scale), cy - (pathH/2 * scale), pathW * scale, pathH * scale);
        }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Tabs (Yellow Blocks)
    if (params.enableTabs && params.tabs.length > 0) {
        ctx.fillStyle = 'rgba(255, 255, 0, 0.7)';
        ctx.strokeStyle = '#cca300';
        
        // Tab visualization logic
        // We need to calculate tab positions relative to center (cx, cy)
        // Similar to generator logic, but visual only
        
        // Rect: width/height are w, h
        // Circle: radius r
        
        const tW = params.tabWidth * scale; // Scaled tab width
        // For visualization, we just draw a box at the location
        
        params.tabs.forEach(tab => {
            let tx = cx; 
            let ty = cy;
            
            // Adjust for offset (tool radius) if we want to show them on the toolpath
            // Or just show them on the shape edge? Shape edge is clearer for "Tabs".
            // Let's show on shape edge.
            
            if (params.shape === 'circle') {
                const angleRad = (tab.angle * Math.PI) / 180;
                tx = cx + (r * scale * Math.cos(angleRad));
                ty = cy + (r * scale * Math.sin(angleRad)); // Canvas Y is down, but standard math is up? 
                // In canvas, positive Y is down. 
                // 0 degrees is usually Right (3 oclock). 
                // 90 degrees: cos=0, sin=1 -> Down. (6 oclock).
                // If we want standard Cartesian (CCW from East), we need -sin for Y.
                // But G-code usually follows standard engineering.
                // Let's assume 0 = East, 90 = North (Up).
                // So Y should be -sin.
                // Re-calculating for standard math:
                const stdAngleRad = (tab.angle * Math.PI) / 180;
                tx = cx + (r * scale * Math.cos(stdAngleRad));
                ty = cy - (r * scale * Math.sin(stdAngleRad)); 
                
                // Draw a circle for the tab?
                ctx.beginPath();
                ctx.arc(tx, ty, tW/2, 0, Math.PI*2);
                ctx.fill();
                ctx.stroke();
                
            } else {
                // Rect
                // w, h are unscaled params
                const halfW = (w * scale) / 2;
                const halfH = (h * scale) / 2;
                const tabOffset = (tab.offset / 100); // 0.0 to 1.0
                
                // Side definitions:
                // Bottom: y = +halfH, x goes from -halfW to +halfW? 
                // Let's define standard direction:
                // Bottom: Left -> Right
                // Right: Bottom -> Top
                // Top: Right -> Left
                // Left: Top -> Bottom
                // (Matches CCW cutting usually)
                
                if (tab.side === 'bottom') {
                    // Along bottom edge: from Left (-halfW) to Right (+halfW)
                    tx = cx - halfW + (w * scale * tabOffset);
                    ty = cy + halfH;
                } else if (tab.side === 'right') {
                    tx = cx + halfW;
                    ty = cy + halfH - (h * scale * tabOffset); // Upwards
                } else if (tab.side === 'top') {
                    // Right to Left? Or Left to Right? 
                    // Usually "50%" means center regardless.
                    // Let's assume Left->Right for Top to be intuitive for UI "Position %"
                    tx = cx - halfW + (w * scale * tabOffset);
                    ty = cy - halfH;
                } else if (tab.side === 'left') {
                    // Bottom to Top?
                    tx = cx - halfW;
                    ty = cy + halfH - (h * scale * tabOffset); 
                }
                
                // Draw rect centered at tx, ty
                ctx.fillRect(tx - tW/2, ty - tW/2, tW, tW); // Square marker
                ctx.strokeRect(tx - tW/2, ty - tW/2, tW, tW);
            }
        });
    }
}

function downloadGCode() {
    const blob = new Blob([gcodeOutput.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opengcode-${Date.now()}.gcode`;
    a.click();
    URL.revokeObjectURL(url);
}

// Tool Library Functions
async function loadToolLibrary() {
    try {
        const response = await fetch('tool-library/index.json');
        if (!response.ok) throw new Error('Failed to load tool library');
        const tools = await response.json();
        
        tools.forEach(tool => {
            const option = document.createElement('option');
            option.value = tool.file;
            option.textContent = tool.name;
            toolPreset.appendChild(option);
        });
    } catch (e) {
        console.warn('Tool library not found or invalid:', e);
    }
}

async function loadSelectedTool(e) {
    const filename = e.target.value;
    if (!filename) return; // Custom

    try {
        const response = await fetch(`tool-library/${filename}`);
        if (!response.ok) throw new Error('Failed to load tool');
        const data = await response.json();
        
        // Update inputs
        if (data.toolDiameter) document.getElementById('toolDiameter').value = data.toolDiameter;
        if (data.feedRate) document.getElementById('feedRate').value = data.feedRate;
        if (data.spindleSpeed) document.getElementById('spindleSpeed').value = data.spindleSpeed;
        if (data.passDepth) document.getElementById('passDepth').value = data.passDepth;
        if (data.safeZ) document.getElementById('safeZ').value = data.safeZ;

        update(); // Trigger preview update
    } catch (e) {
        console.error('Error loading tool:', e);
        alert('Could not load tool preset.');
    }
}

function saveToolPreset() {
    const params = getParams();
    const toolData = {
        toolDiameter: params.toolDiameter,
        feedRate: params.feedRate,
        spindleSpeed: params.spindleSpeed,
        passDepth: params.passDepth,
        safeZ: params.safeZ
    };
    
    const json = JSON.stringify(toolData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const name = prompt("Enter a filename for this tool (e.g. my_tool.json):", "custom_tool.json");
    if (!name) return;
    
    a.download = name.endsWith('.json') ? name : name + '.json';
    a.click();
    URL.revokeObjectURL(url);
    
    alert(`Saved! Move this file to the '/tool-library' folder and add it to 'index.json' to see it in the list.`);
}

// Start
init();