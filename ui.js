import { GCodeGenerator } from './generator.js';
import { init3D, update3D, resize3D } from './visualizer3d.js';
import { Sketcher } from './sketcher.js';

const generator = new GCodeGenerator();
let sketcher; // Instance

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
const clearSketchBtn = document.getElementById('clearSketchBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const gridIncBtn = document.getElementById('gridIncBtn');
const gridDecBtn = document.getElementById('gridDecBtn');
const gridSizeDisplay = document.getElementById('gridSizeDisplay');

// Tab DOM Elements
const enableTabsCheckbox = document.getElementById('enableTabs');
const tabWidthInput = document.getElementById('tabWidth');
const tabThicknessInput = document.getElementById('tabThickness');
const tabContainer = document.getElementById('tabContainer');
const tabList = document.getElementById('tabList');
const addTabBtn = document.getElementById('addTabBtn');

// View Tabs
const threeContainer = document.getElementById('three-container');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

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
    circle: [{ id: 'diameter', label: 'Diameter (mm)', value: 50 }],
    sketch: [] // No dimensions for sketch
};

function init() {
    renderDimensions('square'); // Default
    loadToolLibrary();
    attachListeners();
    setupTabs();
    
    // Init 3D Scene
    init3D(threeContainer);
    
    // Init Sketcher
    sketcher = new Sketcher('sketchCanvas');
    sketcher.onUpdate(update);
    
    update();
}

function setupTabs() {
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function switchTab(targetId) {
    // Remove active
    tabButtons.forEach(b => {
        if(b.dataset.tab === targetId) b.classList.add('active');
        else b.classList.remove('active');
    });
    
    tabContents.forEach(c => {
        if(c.id === targetId) c.classList.add('active');
        else c.classList.remove('active');
    });
    
    // Trigger 3D Resize if needed
    if (targetId === 'view-3d') {
        setTimeout(() => resize3D(), 50);
    }
}

function renderDimensions(shape) {
    dimensionInputs.innerHTML = '';
    const config = shapeConfigs[shape];
    
    if (shape === 'sketch') {
        dimensionInputs.innerHTML = '<small>Draw your shape in the "Sketch" tab.</small>';
        return;
    }
    
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
        
        // Clear tabs if switching logic (Rect <-> Circle)
        const isRect = s => s === 'square' || s === 'rectangle';
        if (tabs.length > 0) {
            const hasAngle = tabs[0].angle !== undefined;
            const newIsRect = isRect(newShape);
            
            if ((hasAngle && newIsRect) || (!hasAngle && !newIsRect)) {
                tabs = [];
            }
        }

        renderDimensions(newShape);
        renderTabs();
        
        if (newShape === 'sketch') {
            switchTab('view-sketch');
        }
        
        update();
    });
    
    originSelect.addEventListener('change', update);

    inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', update);
    });
    
    clearSketchBtn.addEventListener('click', () => {
        sketcher.clear();
    });

    zoomInBtn.addEventListener('click', () => sketcher.zoom(1.2));
    zoomOutBtn.addEventListener('click', () => sketcher.zoom(0.8));
    
    gridIncBtn.addEventListener('click', () => {
        const s = sketcher.changeGrid(5);
        gridSizeDisplay.textContent = s + 'mm';
    });
    
    gridDecBtn.addEventListener('click', () => {
        const s = sketcher.changeGrid(-5);
        gridSizeDisplay.textContent = s + 'mm';
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
    
    if (shape === 'sketch') {
        tabList.innerHTML = '<small>Tabs not supported for custom sketches yet.</small>';
        return;
    }
    
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
    
    // Helper to safely get number values
    const getNum = (id) => {
        const el = document.getElementById(id);
        return el ? (parseFloat(el.value) || 0) : 0;
    };

    const params = {
        shape: shape,
        origin: originSelect.value,
        toolDiameter: getNum('toolDiameter'),
        operation: document.getElementById('operation').value,
        targetDepth: getNum('targetDepth'),
        passDepth: getNum('passDepth'),
        safeZ: getNum('safeZ'),
        spindleSpeed: getNum('spindleSpeed'),
        feedRate: getNum('feedRate'),
        enableRapid: enableRapidCheckbox.checked,
        rapidXY: getNum('rapidXY'),
        rapidZ: getNum('rapidZ'),
        stockThickness: getNum('stockThickness'),
        // Tab Params
        enableTabs: enableTabsCheckbox.checked,
        tabWidth: getNum('tabWidth'),
        tabThickness: getNum('tabThickness'),
        tabs: [...tabs], // Copy
        sketchPoints: sketcher ? sketcher.getPoints() : []
    };

    // Add dynamic shape params
    if (shape === 'square') {
        params.width = getNum('width');
        params.shapeWidth = params.width;
        params.shapeHeight = params.width;
    } else if (shape === 'rectangle') {
        params.width = getNum('width');
        params.height = getNum('height');
        params.shapeWidth = params.width;
        params.shapeHeight = params.height;
    } else if (shape === 'circle') {
        params.diameter = getNum('diameter');
        params.shapeWidth = params.diameter;
        params.shapeHeight = params.diameter;
    } else if (shape === 'sketch') {
        // Calculate bounds of sketch for stock auto-size
        if (params.sketchPoints.length > 0) {
            const xs = params.sketchPoints.map(p => p.x);
            const ys = params.sketchPoints.map(p => p.y);
            const w = Math.max(...xs) - Math.min(...xs);
            const h = Math.max(...ys) - Math.min(...ys);
            params.shapeWidth = w;
            params.shapeHeight = h;
        } else {
            params.shapeWidth = 0;
            params.shapeHeight = 0;
        }
    }

    // Stock Params
    const userStockW = getNum('stockWidth');
    const userStockH = getNum('stockHeight');
    
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
    
    // Draw 3D
    update3D(code, params);
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

    // Draw Shape
    if (params.shape === 'sketch') {
        if (params.sketchPoints.length > 0) {
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            // Need to transform logic points (relative to Sketch Center (0,0)) to Canvas Preview
            // But Wait, where is (0,0) in Sketch? It's the center of the canvas.
            // Where is (0,0) in G-Code? It's determined by Job Origin.
            // The visualizer draws things relative to Stock Center `cx, cy` if Job Origin is centered?
            // Actually `drawPreview` assumes shape is centered in stock.
            // For Sketch, the points are absolute relative to sketch origin.
            // Let's assume Sketch Origin (0,0) aligns with Job Origin (0,0) or Center of Shape?
            
            // Simplest: Treat Sketch Points as relative to Stock Center (if origin is stock center).
            // Or just draw them relative to `axisX, axisY` (which is the Job Origin).
            // Yes, standard G-Code thinking: The drawn points are coordinates relative to (0,0).
            // So we draw them relative to `axisX` and `axisY`.
            // Wait, Y needs inversion because Canvas Y is Down.
            
            params.sketchPoints.forEach((p, i) => {
                const px = axisX + (p.x * scale);
                const py = axisY - (p.y * scale); // Invert Y for Cartesian
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            });
            ctx.closePath();
            ctx.stroke();
        }
    } else {
        // Standard Shape
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
    }

    // Draw Toolpath (Red Dashed)
    // ... For sketch, toolpath logic is in Generator.
    // If Generator produces output, we can't easily visualize the offset path here without duplicating logic.
    // But we can visualize the generated G-Code in 2D? No, `drawPreview` is "Ideal Shape".
    // The "Toolpath" visualization is currently simplified (just offset rect).
    // For Sketch, we might skip the dashed blue line here or implement simple offset.
    // Let's skip for sketch for now, rely on 3D viz for true toolpath.
    
    if (params.shape !== 'sketch') {
        let offset = 0;
        if (params.operation === 'outside') offset = params.toolDiameter / 2;
        if (params.operation === 'inside') offset = -params.toolDiameter / 2;

        ctx.strokeStyle = '#0000ff'; // Blue toolpath
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        
        if (params.shape === 'circle') {
            let r = params.diameter / 2;
            const pathR = r + offset;
            if (pathR > 0) ctx.arc(cx, cy, pathR * scale, 0, Math.PI * 2);
        } else {
            let w = params.width; if(params.shape==='square') w=params.width;
            let h = params.height; if(params.shape==='square') h=params.width;
            const pathW = w + (offset * 2);
            const pathH = h + (offset * 2);
            if (pathW > 0 && pathH > 0) {
                ctx.rect(cx - (pathW/2 * scale), cy - (pathH/2 * scale), pathW * scale, pathH * scale);
            }
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Draw Tabs (Yellow Blocks)
    if (params.enableTabs && params.tabs.length > 0 && params.shape !== 'sketch') {
        // ... existing tab drawing ...
        ctx.fillStyle = 'rgba(255, 255, 0, 0.7)';
        ctx.strokeStyle = '#cca300';
        
        const tW = params.tabWidth * scale; 
        
        let w = params.width; if(params.shape==='square') w=params.width;
        let h = params.height; if(params.shape==='square') h=params.width;
        let r = params.diameter/2;

        params.tabs.forEach(tab => {
            let tx = cx; 
            let ty = cy;
            
            if (params.shape === 'circle') {
                const stdAngleRad = (tab.angle * Math.PI) / 180;
                tx = cx + (r * scale * Math.cos(stdAngleRad));
                ty = cy - (r * scale * Math.sin(stdAngleRad)); 
                ctx.beginPath();
                ctx.arc(tx, ty, tW/2, 0, Math.PI*2);
                ctx.fill();
                ctx.stroke();
            } else {
                const halfW = (w * scale) / 2;
                const halfH = (h * scale) / 2;
                const tabOffset = (tab.offset / 100); 
                
                if (tab.side === 'bottom') {
                    tx = cx - halfW + (w * scale * tabOffset);
                    ty = cy + halfH;
                } else if (tab.side === 'right') {
                    tx = cx + halfW;
                    ty = cy + halfH - (h * scale * tabOffset); 
                } else if (tab.side === 'top') {
                    tx = cx - halfW + (w * scale * tabOffset);
                    ty = cy - halfH;
                } else if (tab.side === 'left') {
                    tx = cx - halfW;
                    ty = cy + halfH - (h * scale * tabOffset); 
                }
                ctx.fillRect(tx - tW/2, ty - tW/2, tW, tW); 
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