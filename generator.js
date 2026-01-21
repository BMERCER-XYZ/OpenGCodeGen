/**
 * G-Code Generator Logic
 */

export class GCodeGenerator {
    constructor() {
        this.params = {};
    }

    setParams(params) {
        this.params = params;
    }

    /**
     * Generates the full G-code string
     */
    generate() {
        const p = this.params;
        const lines = [];

        // Header
        lines.push(`; OpenGCodeGen - ${p.shape} Operation`);
        lines.push(`; Tool Dia: ${p.toolDiameter}mm | Depth: ${p.targetDepth}mm`);
        lines.push(`; Origin: ${p.origin || 'center'}`);
        if (p.enableTabs) lines.push(`; Tabs Enabled: ${p.tabs.length} tabs`);
        lines.push('G21 ; Units in mm');
        lines.push('G90 ; Absolute positioning');
        lines.push(`M3 S${p.spindleSpeed} ; Spindle on`);
        
        // Initial Safe Z
        lines.push(`${this.getRapidZ(p.safeZ)} ; Move to safe Z`);

        // Calculate offset based on operation type
        let offset = 0;
        if (p.operation === 'outside') offset = p.toolDiameter / 2;
        if (p.operation === 'inside') offset = -p.toolDiameter / 2;
        // center = 0

        // Generate passes
        let currentZ = 0;
        while (currentZ > -p.targetDepth) {
            currentZ -= p.passDepth;
            if (currentZ < -p.targetDepth) currentZ = -p.targetDepth;
            
            lines.push(`; Pass at Z=${currentZ.toFixed(2)}`);
            
            // Move to start position (Rapid)
            const startPos = this.getStartPosition(p.shape, offset);
            lines.push(this.getRapidXY(startPos.x, startPos.y));
            
            // Plunge
            lines.push(`G1 Z${currentZ.toFixed(3)} F${p.feedRate / 2}`); // Plunge at half feed usually safer
            
            // Cut Path
            lines.push(...this.getShapePath(p.shape, offset, p.feedRate, currentZ));
        }

        // Footer
        lines.push(`${this.getRapidZ(p.safeZ)} ; Retract`);
        lines.push('M5 ; Spindle off');
        lines.push('M30 ; End of program');

        return lines.join('\n');
    }

    getRapidZ(z) {
        const p = this.params;
        if (p.enableRapid) {
            return `G1 Z${z.toFixed(3)} F${p.rapidZ}`;
        }
        return `G0 Z${z.toFixed(3)}`;
    }

    getRapidXY(x, y) {
        const p = this.params;
        if (p.enableRapid) {
            return `G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${p.rapidXY}`;
        }
        return `G0 X${x.toFixed(3)} Y${y.toFixed(3)}`;
    }

    getTranslation() {
        const p = this.params;
        const t = { x: 0, y: 0 };
        const originVal = p.origin || 'stock-center';

        let w = 0;
        let h = 0;
        let pos = 'center';

        if (originVal.startsWith('shape-')) {
            w = p.shapeWidth;
            h = p.shapeHeight;
            pos = originVal.replace('shape-', '');
        } else {
            // Default to stock (handles 'stock-' prefix and legacy/fallback)
            w = p.stockWidth;
            h = p.stockHeight;
            pos = originVal.replace('stock-', '');
        }

        if (pos === 'center') return t;

        if (pos === 'bottom-left') { t.x = w/2; t.y = h/2; }
        else if (pos === 'bottom-right') { t.x = -w/2; t.y = h/2; }
        else if (pos === 'top-left') { t.x = w/2; t.y = -h/2; }
        else if (pos === 'top-right') { t.x = -w/2; t.y = -h/2; }

        return t;
    }

    getStartPosition(shape, offset) {
        const p = this.params;
        const t = this.getTranslation();
        
        if (shape === 'square' || shape === 'rectangle') {
            const w = (shape === 'square' ? p.width : p.width) / 2 + offset;
            const h = (shape === 'square' ? p.width : p.height) / 2 + offset;
            // Start bottom-left corner relative to center
            return { x: -w + t.x, y: -h + t.y };
        } 
        else if (shape === 'circle') {
            const r = (p.diameter / 2) + offset;
            // Start at 3 o'clock position
            return { x: r + t.x, y: 0 + t.y };
        }
        return { x: 0, y: 0 };
    }

    getShapePath(shape, offset, feedRate, currentZ) {
        const p = this.params;
        const t = this.getTranslation();
        const moves = [];

        // Tab Logic
        const tabTopZ = -(p.targetDepth - p.tabThickness);
        // We cut tabs if currentZ is LOWER (deeper) than the top of the tab
        const isTabPass = p.enableTabs && p.tabs && p.tabs.length > 0 && (currentZ < tabTopZ - 0.001);

        if (shape === 'square' || shape === 'rectangle') {
            const wRaw = (shape === 'square' ? p.width : p.width);
            const hRaw = (shape === 'square' ? p.width : p.height);
            const w = wRaw / 2 + offset;
            const h = hRaw / 2 + offset;

            // Corners (Relative to center)
            const bl = { x: -w, y: -h }; // Start
            const br = { x: w, y: -h };
            const tr = { x: w, y: h };
            const tl = { x: -w, y: h };
            
            // Segments: Bottom (BL->BR), Right (BR->TR), Top (TR->TL), Left (TL->BL)
            const sides = [
                { name: 'bottom', start: bl, end: br, len: w*2, axis: 'x' },
                { name: 'right', start: br, end: tr, len: h*2, axis: 'y' },
                { name: 'top', start: tr, end: tl, len: w*2, axis: 'x' },
                { name: 'left', start: tl, end: bl, len: h*2, axis: 'y' }
            ];

            sides.forEach(side => {
                let sideMoves = [];
                // Find tabs for this side
                const sideTabs = isTabPass ? p.tabs.filter(tb => tb.side === side.name) : [];
                
                if (sideTabs.length === 0) {
                    // Normal Move
                    sideMoves.push({ x: side.end.x + t.x, y: side.end.y + t.y });
                } else {
                    // Sort tabs by offset %
                    sideTabs.sort((a, b) => a.offset - b.offset);
                    
                    let currentPos = { ...side.start }; // Local coords

                    sideTabs.forEach(tab => {
                        // Calculate Tab Center distance from start
                        const dist = side.len * (tab.offset / 100);
                        const tabHalfW = p.tabWidth / 2;
                        
                        // Tab Start/End distances
                        const dStart = Math.max(0, dist - tabHalfW);
                        const dEnd = Math.min(side.len, dist + tabHalfW);
                        
                        // Check if valid tab (has length)
                        if (dEnd > dStart) {
                            // Interpolate Position for Tab Start
                            const pStart = this.interpolate(side.start, side.end, dStart / side.len);
                            const pEnd = this.interpolate(side.start, side.end, dEnd / side.len);
                            
                            // Move to Tab Start (Cut)
                            moves.push(`G1 X${(pStart.x + t.x).toFixed(3)} Y${(pStart.y + t.y).toFixed(3)} F${feedRate}`);
                            
                            // Lift to Tab Top
                            // Usually use RapidZ or FeedZ? For tab hopping, G1 is safer/smoother usually, or G0 if rapid enabled.
                            // We'll use getRapidZ logic but targeting tabTopZ
                            if (p.enableRapid) {
                                moves.push(`G1 Z${tabTopZ.toFixed(3)} F${p.rapidZ}`); 
                            } else {
                                moves.push(`G0 Z${tabTopZ.toFixed(3)}`);
                            }
                            
                            // Move to Tab End (at Tab Height)
                            moves.push(`G1 X${(pEnd.x + t.x).toFixed(3)} Y${(pEnd.y + t.y).toFixed(3)} F${feedRate}`);
                            
                            // Plunge back to currentZ
                             moves.push(`G1 Z${currentZ.toFixed(3)} F${p.feedRate / 2}`);
                        }
                    });
                    
                    // Final move to End of Side
                    sideMoves.push({ x: side.end.x + t.x, y: side.end.y + t.y });
                }

                // Add side moves (only the cut ones, headers were added in loop)
                sideMoves.forEach(m => {
                    moves.push(`G1 X${m.x.toFixed(3)} Y${m.y.toFixed(3)} F${feedRate}`);
                });
            });

        } 
        else if (shape === 'circle') {
            const r = (p.diameter / 2) + offset;
            
            if (!isTabPass) {
                // Normal Circle
                const endX = r + t.x;
                const endY = 0 + t.y;
                const I = -r;
                const J = 0;
                moves.push(`G3 X${endX.toFixed(3)} Y${endY.toFixed(3)} I${I.toFixed(3)} J${J.toFixed(3)} F${feedRate}`);
            } else {
                // Tabbed Circle
                const sortedTabs = [...p.tabs].sort((a, b) => a.angle - b.angle);
                let currentAngle = 0; // Start at 3 o'clock
                
                // Helper to get coords from angle
                const getCoords = (angleDeg) => {
                    const rad = (angleDeg * Math.PI) / 180;
                    return {
                        x: t.x + r * Math.cos(rad),
                        y: t.y + r * Math.sin(rad)
                    };
                };

                // Helper for Arc Move
                const addArc = (startAng, endAng) => {
                    // G3 params
                    // Target (endAng)
                    const end = getCoords(endAng);
                    
                    // I, J are offset from Start Point to Center
                    // Start Point is implicitly current pos.
                    // Center is (t.x, t.y).
                    // So I = Center.x - Start.x
                    // J = Center.y - Start.y
                    const start = getCoords(startAng);
                    const I = t.x - start.x;
                    const J = t.y - start.y;
                    
                    moves.push(`G3 X${end.x.toFixed(3)} Y${end.y.toFixed(3)} I${I.toFixed(3)} J${J.toFixed(3)} F${feedRate}`);
                };

                sortedTabs.forEach(tab => {
                    // Tab Width in Angle
                    // ArcLength = r * theta_rad
                    // theta_rad = Width / r
                    // theta_deg = (Width / r) * (180/PI)
                    const halfAngleW = ((p.tabWidth / r) * (180 / Math.PI)) / 2;
                    
                    let startA = tab.angle - halfAngleW;
                    let endA = tab.angle + halfAngleW;
                    
                    // Handle wrapping? For simplicity, clamp/skip if crossing 0/360 boundary for now, 
                    // or assume user defines properly.
                    // If startA < 0, it wraps. Complex. 
                    // Simple logic: If tab is within current segment (Current -> 360).
                    
                    if (startA > currentAngle) {
                        // Cut arc from current to Tab Start
                        addArc(currentAngle, startA);
                        
                        // Lift
                         if (p.enableRapid) {
                            moves.push(`G1 Z${tabTopZ.toFixed(3)} F${p.rapidZ}`); 
                        } else {
                            moves.push(`G0 Z${tabTopZ.toFixed(3)}`);
                        }
                        
                        // Move over tab (Linear or Arc? Ideally Arc to keep shape)
                        // G3 at height
                        const tabEnd = getCoords(endA);
                        // I,J from new start (TabStart)
                        const tabStart = getCoords(startA);
                        const I = t.x - tabStart.x;
                        const J = t.y - tabStart.y;
                        moves.push(`G3 X${tabEnd.x.toFixed(3)} Y${tabEnd.y.toFixed(3)} I${I.toFixed(3)} J${J.toFixed(3)} F${feedRate}`);

                        // Plunge
                        moves.push(`G1 Z${currentZ.toFixed(3)} F${p.feedRate / 2}`);
                        
                        currentAngle = endA;
                    }
                });

                // Final Arc to 360 (0)
                if (currentAngle < 360) {
                    // Note: 360 is same coords as 0.
                    // If currentAngle is 350, we go to 360.
                    // If currentAngle is 0, we do full circle (handled by !isTabPass usually, but here logic differs)
                    // If we have tabs, we assume we broke the circle.
                    // If last tab ended at 350, we need to close the loop.
                    
                    // Problem: G3 to 0 degrees (360).
                    // Coordinates of 360 are same as 0.
                    // G3 logic needs correct I,J.
                    addArc(currentAngle, 360);
                }
            }
        }

        return moves;
    }
    
    interpolate(p1, p2, t) {
        return {
            x: p1.x + (p2.x - p1.x) * t,
            y: p1.y + (p2.y - p1.y) * t
        };
    }
}
