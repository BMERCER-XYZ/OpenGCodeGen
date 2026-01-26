export class Sketcher {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.points = [];
        this.textObjects = [];
        this.mode = 'vertex'; // 'vertex' or 'text'
        this.isClosed = false;
        this.gridSize = 10; // 10mm
        this.scale = 1; // Pixels per mm, usually handled by draw transform
        
        // Canvas Setup
        // We'll treat the canvas center as (0,0) logically
        this.origin = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
        this.pixelsPerUnit = 2; // 1mm = 2px (fits 250mm width)

        this.mousePos = null;

        this.attachListeners();
        this.draw();
    }

    attachListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.onClick(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
        this.canvas.addEventListener('mouseleave', () => { this.mousePos = null; this.draw(); });
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    // Convert Screen (px) to Logic (mm relative to center)
    screenToLogic(pos) {
        return {
            x: (pos.x - this.origin.x) / this.pixelsPerUnit,
            y: (pos.y - this.origin.y) / this.pixelsPerUnit // Y grows down in canvas
        };
    }
    
    // Convert Logic (mm) to Screen (px)
    logicToScreen(pos) {
        return {
            x: this.origin.x + (pos.x * this.pixelsPerUnit),
            y: this.origin.y + (pos.y * this.pixelsPerUnit)
        };
    }

    snap(pos) {
        // Snap logic coordinates to grid
        const sx = Math.round(pos.x / this.gridSize) * this.gridSize;
        const sy = Math.round(pos.y / this.gridSize) * this.gridSize;
        return { x: sx, y: sy };
    }

    setMode(mode) {
        this.mode = mode;
        this.draw();
    }

    onClick(e) {
        const raw = this.screenToLogic(this.getMousePos(e));
        const p = this.snap(raw);

        if (this.mode === 'text') {
            const textEl = document.getElementById('sketchText');
            const sizeEl = document.getElementById('sketchTextSize');
            const text = textEl ? textEl.value : 'TEXT';
            const size = sizeEl ? parseFloat(sizeEl.value) : 10;
            
            if (text) {
                this.textObjects.push({
                    text: text,
                    x: p.x,
                    y: p.y,
                    size: size
                });
                this.draw();
                this.triggerUpdate();
            }
            return;
        }

        if (this.isClosed) return;

        // Check closing
        if (this.points.length > 2) {
            const start = this.points[0];
            // Distance check
            const d = Math.sqrt(Math.pow(p.x - start.x, 2) + Math.pow(p.y - start.y, 2));
            if (d < 5) { // Close if within 5mm of start
                this.isClosed = true;
                this.draw();
                this.triggerUpdate(); // Notify UI
                return;
            }
        }

        this.points.push(p);
        this.draw();
        this.triggerUpdate();
    }

    onMove(e) {
        const raw = this.screenToLogic(this.getMousePos(e));
        this.mousePos = this.snap(raw);
        this.draw();
    }

    draw() {
        // Clear
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw Grid
        this.ctx.strokeStyle = '#eee';
        this.ctx.lineWidth = 1;
        
        // Calculate grid lines
        const step = this.gridSize * this.pixelsPerUnit;
        const w = this.canvas.width;
        const h = this.canvas.height;

        this.ctx.beginPath();
        for (let x = this.origin.x; x < w; x += step) { this.ctx.moveTo(x, 0); this.ctx.lineTo(x, h); }
        for (let x = this.origin.x; x > 0; x -= step) { this.ctx.moveTo(x, 0); this.ctx.lineTo(x, h); }
        for (let y = this.origin.y; y < h; y += step) { this.ctx.moveTo(0, y); this.ctx.lineTo(w, y); }
        for (let y = this.origin.y; y > 0; y -= step) { this.ctx.moveTo(0, y); this.ctx.lineTo(w, y); }
        this.ctx.stroke();

        // Axes
        this.ctx.strokeStyle = '#ccc';
        this.ctx.beginPath();
        this.ctx.moveTo(this.origin.x, 0); this.ctx.lineTo(this.origin.x, h);
        this.ctx.moveTo(0, this.origin.y); this.ctx.lineTo(w, this.origin.y);
        this.ctx.stroke();

        // Shape
        if (this.points.length > 0) {
            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            
            const start = this.logicToScreen(this.points[0]);
            this.ctx.moveTo(start.x, start.y);

            // Draw vertices
            this.points.forEach(p => {
                const s = this.logicToScreen(p);
                this.ctx.lineTo(s.x, s.y);
            });

            if (this.isClosed) {
                this.ctx.closePath();
                this.ctx.fillStyle = 'rgba(0, 123, 255, 0.2)'; // Watertight blue
                this.ctx.fill();
            } else if (this.mousePos && this.mode === 'vertex') {
                // Preview line
                const m = this.logicToScreen(this.mousePos);
                this.ctx.lineTo(m.x, m.y);

                // Draw distance label
                const lastPoint = this.points[this.points.length - 1];
                const dx = this.mousePos.x - lastPoint.x;
                const dy = this.mousePos.y - lastPoint.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist > 0) {
                    const lastS = this.logicToScreen(lastPoint);
                    const midX = (lastS.x + m.x) / 2;
                    const midY = (lastS.y + m.y) / 2;
                    
                    this.ctx.save();
                    this.ctx.font = '12px sans-serif';
                    this.ctx.fillStyle = '#007bff';
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'bottom';
                    this.ctx.fillText(`${dist.toFixed(1)} mm`, midX, midY - 5);
                    this.ctx.restore();
                }
            }
            this.ctx.stroke();

            // Draw Points
            this.ctx.fillStyle = '#007bff';
            this.points.forEach(p => {
                const s = this.logicToScreen(p);
                this.ctx.beginPath();
                this.ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
                this.ctx.fill();
            });
            
            // Highlight Start if hovering to close
            if (!this.isClosed && this.mousePos && this.points.length > 2 && this.mode === 'vertex') {
                 const startLogic = this.points[0];
                 const dist = Math.sqrt(Math.pow(this.mousePos.x - startLogic.x, 2) + Math.pow(this.mousePos.y - startLogic.y, 2));
                 if (dist < 0.1) { // Same snapped point
                     const s = this.logicToScreen(this.points[0]);
                     this.ctx.fillStyle = '#ff0000';
                     this.ctx.beginPath();
                     this.ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
                     this.ctx.fill();
                 }
            }
        }

        // Draw Text Objects
        this.textObjects.forEach(obj => {
            const s = this.logicToScreen(obj);
            this.ctx.save();
            this.ctx.font = `${obj.size * this.pixelsPerUnit}px monospace`;
            this.ctx.fillStyle = '#000';
            this.ctx.textBaseline = 'bottom';
            this.ctx.fillText(obj.text, s.x, s.y);
            this.ctx.restore();
        });

        // Show cursor/preview
        if (this.mousePos) {
            const m = this.logicToScreen(this.mousePos);
            if (this.mode === 'text') {
                const textEl = document.getElementById('sketchText');
                const sizeEl = document.getElementById('sketchTextSize');
                const text = textEl ? textEl.value : 'TEXT';
                const size = sizeEl ? parseFloat(sizeEl.value) : 10;
                
                this.ctx.save();
                this.ctx.font = `${size * this.pixelsPerUnit}px monospace`;
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                this.ctx.textBaseline = 'bottom';
                this.ctx.fillText(text, m.x, m.y);
                this.ctx.restore();
            } else if (this.points.length === 0) {
                this.ctx.fillStyle = '#aaa';
                this.ctx.beginPath();
                this.ctx.arc(m.x, m.y, 3, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }

    clear() {
        this.points = [];
        this.textObjects = [];
        this.isClosed = false;
        this.draw();
        this.triggerUpdate();
    }

    getPoints() {
        return this.isClosed ? this.points : [];
    }

    getTextObjects() {
        return this.textObjects;
    }
    
    // Callback registration
    onUpdate(cb) {
        this.updateCallback = cb;
    }
    
    triggerUpdate() {
        if (this.updateCallback) this.updateCallback();
    }

    zoom(factor) {
        this.pixelsPerUnit *= factor;
        this.draw();
    }

    changeGrid(delta) {
        this.gridSize += delta;
        if (this.gridSize < 1) this.gridSize = 1;
        this.draw();
        return this.gridSize;
    }
}
