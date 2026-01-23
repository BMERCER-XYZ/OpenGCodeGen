import { GCodeGenerator } from './generator.js';
import { GCodeViewer } from './visualizer3d.js';
import { Sketcher } from './sketcher.js';

const generator = new GCodeGenerator();
let sketcher, staticViewer, simViewer;
let simSpeed = 1.0;
let lineOffsets = []; // Store start/end indices

// State
let tabs = [];

// Configs
const shapeConfigs = {
    square: [{ id: 'width', label: 'Side Length (mm)', value: 50 }],
    rectangle: [
        { id: 'width', label: 'Width (mm)', value: 80 },
        { id: 'height', label: 'Height (mm)', value: 40 }
    ],
    circle: [{ id: 'diameter', label: 'Diameter (mm)', value: 50 }],
    sketch: []
};

// Safe DOM Helper
const getEl = (id) => document.getElementById(id);
const getNum = (id) => {
    const el = getEl(id);
    return el ? (parseFloat(el.value) || 0) : 0;
};

function init() {
    try {
        // Init Components
        if(getEl('sketchCanvas')) {
            sketcher = new Sketcher('sketchCanvas');
        }
        
        if(getEl('three-container')) {
            staticViewer = new GCodeViewer(getEl('three-container'));
        }
        
        if(getEl('sim-container')) {
            simViewer = new GCodeViewer(getEl('sim-container'));
            simViewer.onProgress(highlightLine);
        }

        renderDimensions('square'); 
        loadToolLibrary();
        attachListeners();
        setupTabs();
        updateUIState();
        update(); 
    } catch (e) {
        console.error(e);
        alert("Error initializing: " + e.message);
    }
}

function updateUIState() {
    const opType = getEl('opType');
    const cConfig = getEl('contourConfig');
    const fConfig = getEl('facingConfig');
    
    if (!opType) return;
    const isFacing = opType.value === 'facing';
    
    if (cConfig) cConfig.style.display = isFacing ? 'none' : 'block';
    if (fConfig) fConfig.style.display = isFacing ? 'grid' : 'none';
}

function setupTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function switchTab(targetId) {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === targetId);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.toggle('active', c.id === targetId);
    });
    
    if (targetId === 'view-3d' && staticViewer) setTimeout(() => staticViewer.resize(), 50);
    if (targetId === 'view-combined' && simViewer) setTimeout(() => simViewer.resize(), 50);
}

function renderDimensions(shape) {
    const container = getEl('dimensionInputs');
    if (!container) return;
    
    container.innerHTML = '';
    const config = shapeConfigs[shape];
    
    if (shape === 'sketch') {
        container.innerHTML = '<small>Draw your shape in the "Sketch" tab.</small>';
        return;
    }
    
    if (config) {
        config.forEach(field => {
            const div = document.createElement('div');
            div.innerHTML = `
                <label>
                    ${field.label}
                    <input type="number" id="${field.id}" value="${field.value}" step="1">
                </label>
            `;
            container.appendChild(div);
        });
    }
}

function attachListeners() {
    const btn = getEl('generateBtn');
    if (btn) btn.addEventListener('click', update);

    const shapeSel = getEl('shapeSelect');
    if (shapeSel) {
        shapeSel.addEventListener('change', (e) => {
            const newShape = e.target.value;
            // Clear tabs logic
            const isRect = s => s === 'square' || s === 'rectangle';
            if (tabs.length > 0) {
                const hasAngle = tabs[0].angle !== undefined;
                const newIsRect = isRect(newShape);
                if ((hasAngle && newIsRect) || (!hasAngle && !newIsRect)) tabs = [];
            }
            renderDimensions(newShape);
            renderTabs();
            if (newShape === 'sketch') switchTab('view-sketch');
        });
    }
    
    const opType = getEl('opType');
    if (opType) opType.addEventListener('change', updateUIState);

    // Sketch Controls
    const clearBtn = getEl('clearSketchBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => sketcher.clear());
    
    if(getEl('zoomInBtn')) getEl('zoomInBtn').addEventListener('click', () => sketcher.zoom(1.2));
    if(getEl('zoomOutBtn')) getEl('zoomOutBtn').addEventListener('click', () => sketcher.zoom(0.8));
    
    if(getEl('gridIncBtn')) getEl('gridIncBtn').addEventListener('click', () => {
        const s = sketcher.changeGrid(5);
        getEl('gridSizeDisplay').textContent = s + 'mm';
    });
    if(getEl('gridDecBtn')) getEl('gridDecBtn').addEventListener('click', () => {
        const s = sketcher.changeGrid(-5);
        getEl('gridSizeDisplay').textContent = s + 'mm';
    });

    // Sim Controls
    if(getEl('simStartBtn')) getEl('simStartBtn').addEventListener('click', () => simViewer.stop());
    if(getEl('simPlayBtn')) getEl('simPlayBtn').addEventListener('click', () => simViewer.play());
    if(getEl('simPauseBtn')) getEl('simPauseBtn').addEventListener('click', () => simViewer.pause());
    if(getEl('simEndBtn')) getEl('simEndBtn').addEventListener('click', () => simViewer.skipEnd());
    
    if(getEl('simSlowerBtn')) getEl('simSlowerBtn').addEventListener('click', () => {
        if (simSpeed > 0.1) simSpeed -= 0.1;
        getEl('simSpeedDisplay').textContent = simSpeed.toFixed(1) + 'x';
        simViewer.setSpeed(simSpeed);
    });
    if(getEl('simFasterBtn')) getEl('simFasterBtn').addEventListener('click', () => {
        simSpeed += 0.1;
        getEl('simSpeedDisplay').textContent = simSpeed.toFixed(1) + 'x';
        simViewer.setSpeed(simSpeed);
    });

    const rapidCheck = getEl('enableRapid');
    if(rapidCheck) {
        rapidCheck.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            getEl('rapidXY').disabled = !enabled;
            getEl('rapidZ').disabled = !enabled;
        });
    }

    const stInput = getEl('stockThickness');
    if(stInput) {
        stInput.addEventListener('input', (e) => {
            if(e.target.value) getEl('targetDepth').value = e.target.value;
        });
    }
    
    // Tab Listeners
    const tabCheck = getEl('enableTabs');
    if (tabCheck) {
        tabCheck.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            getEl('tabWidth').disabled = !enabled;
            getEl('tabThickness').disabled = !enabled;
            getEl('tabContainer').style.display = enabled ? 'block' : 'none';
        });
    }
    
    if(getEl('addTabBtn')) getEl('addTabBtn').addEventListener('click', addTab);
    
    const dlBtn = getEl('downloadBtn');
    if(dlBtn) dlBtn.addEventListener('click', downloadGCode);
    
    const preset = getEl('toolPreset');
    if(preset) preset.addEventListener('change', loadSelectedTool);
    
    const savePreset = getEl('saveToolBtn');
    if(savePreset) savePreset.addEventListener('click', saveToolPreset);
}

function addTab() {
    const shape = getEl('shapeSelect').value;
    if (shape === 'circle') {
        tabs.push({ angle: 0 });
    } else {
        tabs.push({ side: 'bottom', offset: 50 });
    }
    renderTabs();
}

function removeTab(index) {
    tabs.splice(index, 1);
    renderTabs();
}

function updateTab(index, key, value) {
    tabs[index][key] = value;
}
window.updateTab = updateTab;

function renderTabs() {
    const list = getEl('tabList');
    if (!list) return;
    list.innerHTML = '';
    const shape = getEl('shapeSelect').value;
    
    if (shape === 'sketch') {
        list.innerHTML = '<small>Tabs not supported for custom sketches yet.</small>';
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
        
        const btnDiv = document.createElement('div');
        btnDiv.appendChild(delBtn);
        row.appendChild(btnDiv);

        list.appendChild(row);
    });
}

function getParams() {
    const shape = getEl('shapeSelect').value;
    const opTypeSelect = getEl('opType');
    
    const params = {
        shape: shape,
        origin: getEl('originSelect').value,
        toolDiameter: getNum('toolDiameter'),
        operation: getEl('operation').value,
        opType: opTypeSelect ? opTypeSelect.value : 'contour',
        stepover: getNum('stepover'),
        passExtX: getNum('passExtX'),
        passExtY: getNum('passExtY'),
        targetDepth: getNum('targetDepth'),
        passDepth: getNum('passDepth'),
        safeZ: getNum('safeZ'),
        spindleSpeed: getNum('spindleSpeed'),
        feedRate: getNum('feedRate'),
        enableRapid: getEl('enableRapid').checked,
        rapidXY: getNum('rapidXY'),
        rapidZ: getNum('rapidZ'),
        stockThickness: getNum('stockThickness'),
        enableTabs: getEl('enableTabs').checked,
        tabWidth: getNum('tabWidth'),
        tabThickness: getNum('tabThickness'),
        tabs: [...tabs],
        sketchPoints: sketcher ? sketcher.getPoints() : []
    };

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

    const userStockW = getNum('stockWidth');
    const userStockH = getNum('stockHeight');
    params.stockWidth = userStockW > 0 ? userStockW : params.shapeWidth;
    params.stockHeight = userStockH > 0 ? userStockH : params.shapeHeight;

    return params;
}

function update() {
    try {
        const params = getParams();
        generator.setParams(params);
        
        const code = generator.generate();
        getEl('gcodeOutput').value = code;
        
        // Calculate Line Offsets for Highlighting
        lineOffsets = [];
        let cursor = 0;
        const lines = code.split('\n');
        lines.forEach(line => {
            lineOffsets.push({ start: cursor, end: cursor + line.length });
            cursor += line.length + 1; // +1 for \n
        });

        drawPreview(params);
    // Draw 3D
    if (staticViewer) staticViewer.update(code, params);
    if (simViewer) {
        const stats = simViewer.update(code, params);
        if (stats) {
            getEl('estTotalTime').textContent = formatTime(stats.totalTime);
            getEl('estPassTime').textContent = formatTime(stats.avgPassTime);
        }
    }
    } catch (e) {
        console.error("Update failed:", e);
    }
}

function highlightLine(index) {
    const textarea = getEl('gcodeOutput');
    if (!textarea || !lineOffsets[index]) return;
    
    const range = lineOffsets[index];
    
    // Focus needed for selection visualization in some browsers, 
    // but might jump scroll. Textarea is readonly.
    textarea.focus({preventScroll: true});
    textarea.setSelectionRange(range.start, range.end);
    
    // Auto-Scroll
    // Simple estimation: line height approx 1.2em ~ 15-20px depending on font.
    // Let's try to center the line.
    const totalLines = lineOffsets.length;
    if (totalLines > 0) {
        const percent = index / totalLines;
        // textarea.scrollTop = (textarea.scrollHeight - textarea.clientHeight) * percent; 
        // Better:
        const lineHeight = 15; // approximate for monospace 0.85rem
        const scrollPos = (index * lineHeight) - (textarea.clientHeight / 2);
        textarea.scrollTop = scrollPos;
    }
}

function formatTime(minutes) {
    if (!minutes || minutes < 0) return "00:00";
    const m = Math.floor(minutes);
    const s = Math.floor((minutes - m) * 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function drawPreview(params) {
    const canvas = getEl('previewCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Clear Canvas
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    const sw = params.stockWidth;
    const sh = params.stockHeight;
    const maxDim = Math.max(sw, sh) || 100;
    const scale = (Math.min(canvas.width, canvas.height) * 0.7) / maxDim;

    // Draw Stock
    ctx.fillStyle = '#f0f0f0';
    ctx.strokeStyle = '#ccc';
    ctx.setLineDash([5, 5]);
    ctx.fillRect(cx - (sw/2 * scale), cy - (sh/2 * scale), sw * scale, sh * scale);
    ctx.strokeRect(cx - (sw/2 * scale), cy - (sh/2 * scale), sw * scale, sh * scale);
    ctx.setLineDash([]);

    let axisX = cx;
    let axisY = cy;
    const originVal = params.origin || 'stock-center';
    let refW = sw, refH = sh;
    let originPos = 'center';
    if (originVal.startsWith('shape-')) { refW = params.shapeWidth; refH = params.shapeHeight; originPos = originVal.replace('shape-', ''); }
    else { originPos = originVal.replace('stock-', ''); }

    if (originPos === 'bottom-left') { axisX = cx - (refW / 2 * scale); axisY = cy + (refH / 2 * scale); }
    else if (originPos === 'bottom-right') { axisX = cx + (refW / 2 * scale); axisY = cy + (refH / 2 * scale); }
    else if (originPos === 'top-left') { axisX = cx - (refW / 2 * scale); axisY = cy - (refH / 2 * scale); }
    else if (originPos === 'top-right') { axisX = cx + (refW / 2 * scale); axisY = cy - (refH / 2 * scale); }

    // Axes
    ctx.strokeStyle = '#ff0000'; ctx.beginPath(); ctx.moveTo(0, axisY); ctx.lineTo(canvas.width, axisY); ctx.stroke();
    ctx.strokeStyle = '#00ff00'; ctx.beginPath(); ctx.moveTo(axisX, 0); ctx.lineTo(axisX, canvas.height); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(axisX, axisY, 4, 0, Math.PI * 2); ctx.fill();

    // Shape
    if (params.shape === 'sketch' && params.sketchPoints.length > 0) {
        ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath();
        params.sketchPoints.forEach((p, i) => {
            const px = axisX + (p.x * scale);
            const py = axisY - (p.y * scale);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath(); ctx.stroke();
    } else if (params.shape !== 'sketch') {
        let w=params.width, h=params.height, r=params.diameter/2;
        if(params.shape==='square') h=w;
        if(params.shape==='circle') { w=r*2; h=r*2; }
        
        ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath();
        if (params.shape === 'circle') ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
        else ctx.rect(cx - (w/2 * scale), cy - (h/2 * scale), w * scale, h * scale);
        ctx.stroke();
    }

    // Tabs
    if (params.enableTabs && params.tabs.length > 0 && params.shape !== 'sketch') {
        ctx.fillStyle = 'rgba(255, 255, 0, 0.7)'; ctx.strokeStyle = '#cca300';
        const tW = params.tabWidth * scale;
        let w=params.width, h=params.height, r=params.diameter/2;
        if(params.shape==='square') h=w;
        
        params.tabs.forEach(tab => {
            let tx = cx, ty = cy;
            if (params.shape === 'circle') {
                const ang = (tab.angle * Math.PI) / 180;
                tx = cx + (r * scale * Math.cos(ang)); ty = cy - (r * scale * Math.sin(ang));
                ctx.beginPath(); ctx.arc(tx, ty, tW/2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            } else {
                const hW = (w * scale)/2, hH = (h * scale)/2, off = tab.offset/100;
                if (tab.side === 'bottom') { tx = cx - hW + (w * scale * off); ty = cy + hH; }
                else if (tab.side === 'right') { tx = cx + hW; ty = cy + hH - (h * scale * off); }
                else if (tab.side === 'top') { tx = cx - hW + (w * scale * off); ty = cy - hH; }
                else if (tab.side === 'left') { tx = cx - hW; ty = cy + hH - (h * scale * off); }
                ctx.fillRect(tx - tW/2, ty - tW/2, tW, tW); ctx.strokeRect(tx - tW/2, ty - tW/2, tW, tW);
            }
        });
    }
}

function downloadGCode() {
    const blob = new Blob([getEl('gcodeOutput').value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opengcode-${Date.now()}.gcode`;
    a.click();
    URL.revokeObjectURL(url);
}

async function loadToolLibrary() {
    try {
        const response = await fetch('tool-library/index.json');
        if (!response.ok) return;
        const tools = await response.json();
        const preset = getEl('toolPreset');
        if(!preset) return;
        tools.forEach(tool => {
            const option = document.createElement('option');
            option.value = tool.file;
            option.textContent = tool.name;
            preset.appendChild(option);
        });
    } catch (e) { console.warn(e); }
}

async function loadSelectedTool(e) {
    const filename = e.target.value;
    if (!filename) return;
    try {
        const response = await fetch(`tool-library/${filename}`);
        if (!response.ok) throw new Error('Failed');
        const data = await response.json();
        if (data.toolDiameter) getEl('toolDiameter').value = data.toolDiameter;
        if (data.feedRate) getEl('feedRate').value = data.feedRate;
        if (data.spindleSpeed) getEl('spindleSpeed').value = data.spindleSpeed;
        if (data.passDepth) getEl('passDepth').value = data.passDepth;
        if (data.safeZ) getEl('safeZ').value = data.safeZ;
    } catch (e) { alert('Error loading tool.'); }
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
    const name = prompt("Filename:", "tool.json");
    if (!name) return;
    a.download = name.endsWith('.json') ? name : name + '.json';
    a.click();
    URL.revokeObjectURL(url);
    alert('Saved!');
}

document.addEventListener('DOMContentLoaded', init);