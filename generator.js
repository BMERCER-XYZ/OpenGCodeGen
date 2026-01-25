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

        if (p.opType === 'facing') {
            this.generateFacing(lines, p);
        } else {
            // Contour / Sketch Logic
            
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
                
                // Determine Offsets List (Roughing -> Finish)
                const passOffsets = [];
                
                if (p.enableRoughing && p.roughingPasses > 0 && p.roughingStepover > 0) {
                    // Direction Multiplier:
                    // Outside (Cut Out): Roughing passes are larger. Offset increases. (+1)
                    // Inside (Hole): Roughing passes are smaller. Offset decreases (more negative). (-1)
                    // Center (Trace): Roughing? Maybe Stepover to Left/Right? 
                    // Let's assume standard offset logic: Outside (+), Inside (-).
                    
                    let dirMult = 0;
                    if (p.operation === 'outside') dirMult = 1;
                    else if (p.operation === 'inside') dirMult = -1;
                    
                    if (dirMult !== 0) {
                        for (let i = p.roughingPasses; i >= 1; i--) {
                            passOffsets.push(offset + (i * p.roughingStepover * dirMult));
                        }
                    }
                }
                
                // Add Final Finish Pass
                passOffsets.push(offset);
                
                // Execute Passes
                passOffsets.forEach((currentOffset, idx) => {
                    const isFinish = idx === passOffsets.length - 1;
                    const passName = isFinish ? 'Finish' : `Roughing ${p.roughingPasses - idx}`;
                    lines.push(`; ${passName} Pass`);
                    
                    // Calculate Start & Leads
                    const startPos = this.getStartPosition(p.shape, currentOffset);
                    const leadIn = this.getLeadIn(p.shape, startPos, currentOffset, p);
                    const leadOut = this.getLeadOut(p.shape, startPos, currentOffset, p);
                    
                    // Move to Start (Lead Start or Shape Start)
                    const moveStart = leadIn ? leadIn.start : startPos;
                    
                    lines.push(this.getRapidXY(moveStart.x, moveStart.y));
                    
                    // Plunge
                    lines.push(`G1 Z${currentZ.toFixed(3)} F${p.feedRate / 2}`); 
                    
                    // Lead In
                    if (leadIn && leadIn.moves) lines.push(...leadIn.moves);
                    
                    // Cut Path
                    lines.push(...this.getShapePath(p.shape, currentOffset, p.feedRate, currentZ));
                    
                    // Lead Out
                    if (leadOut && leadOut.moves) lines.push(...leadOut.moves);
                    
                    // Retract slightly if roughing to avoid dragging?
                    // Or just Rapid XY to next start? 
                    // Usually safer to lift if multiple passes at same Z.
                    if (!isFinish) {
                         lines.push(this.getRapidZ(p.safeZ));
                    }
                });
            }
        }

        // Footer
        lines.push(`${this.getRapidZ(p.safeZ)} ; Retract`);
        lines.push('M5 ; Spindle off');
        lines.push('M30 ; End of program');

        return lines.join('\n');
    }

    generateFacing(lines, p) {
        // Facing Logic: Zig-Zag over the Shape area (Rectangular bounding box)
        // If Shape is Circle, we still face the bounding box? Or implement Circular facing?
        // Let's implement Rectangular Zig-Zag for all shapes for simplicity in V1, 
        // effectively facing the bounding box.
        
        let w = 0, h = 0;
        if (p.shape === 'square') { w = p.width; h = p.width; }
        else if (p.shape === 'rectangle') { w = p.width; h = p.height; }
        else if (p.shape === 'circle') { w = p.diameter; h = p.diameter; }
        else if (p.shape === 'sketch') { w = p.shapeWidth; h = p.shapeHeight; } // Calculated in ui.js
        
        // Adjust for Tool Diameter? 
        // Usually facing extends PAST the edge by tool radius to clear edges.
        // Bounds: -w/2 to +w/2.
        // Cut Extent: -w/2 - r to +w/2 + r.
        const r = p.toolDiameter / 2;
        const passExtX = p.passExtX || 0;
        const passExtY = p.passExtY || 0;
        
        const startX = -(w/2) - r - passExtX; // Overhang + Extension
        const endX = (w/2) + r + passExtX;
        const startY = -(h/2) - r - passExtY;
        const endY = (h/2) + r + passExtY; // Ensure we cover this
        
        const step = p.stepover > 0 ? p.stepover : (p.toolDiameter * 0.4); // Default fallback
        const t = this.getTranslation();

        let currentZ = 0;
        while (currentZ > -p.targetDepth) {
            currentZ -= p.passDepth;
            if (currentZ < -p.targetDepth) currentZ = -p.targetDepth;
            
            lines.push(`; Facing Pass at Z=${currentZ.toFixed(2)}`);
            
            // Direction Logic
            // Both: Alternate
            // Climb: Always Left->Right (Start->End) ? Assuming Step Y+
            // Conventional: Always Right->Left (End->Start) ? Assuming Step Y+
            
            // Existing logic defined startX (Left) and endX (Right).
            // startY (Bottom) to endY (Top).
            
            let y = startY;
            
            // For 'climb' or 'conventional', we enforce direction.
            // For 'both', we toggle.
            
            // Climb (Step Y+, Spindle CW): Cut X+ (Left->Right).
            // Conventional: Cut X- (Right->Left).
            
            let cutDir = 1; // 1 = L->R, -1 = R->L
            if (p.facingDirection === 'conventional') cutDir = -1;
            
            // Initial Start Move
            let startXRun = cutDir === 1 ? startX : endX;
            lines.push(this.getRapidXY(startXRun + t.x, y + t.y));
            lines.push(`G1 Z${currentZ.toFixed(3)} F${p.feedRate / 2}`);
            
            while (y <= endY + 0.001) {
                // Cut X
                const targetX = cutDir === 1 ? endX : startX;
                lines.push(`G1 X${(targetX + t.x).toFixed(3)} Y${(y + t.y).toFixed(3)} F${p.feedRate}`);
                
                // Stepover Y
                if (y < endY) {
                    let nextY = y + step;
                    if (nextY > endY) nextY = endY;
                    
                    if (p.facingDirection === 'both') {
                        // Zig-Zag: Move Y, Toggle Dir
                        lines.push(`G1 X${(targetX + t.x).toFixed(3)} Y${(nextY + t.y).toFixed(3)} F${p.feedRate}`);
                        cutDir *= -1;
                    } else {
                        // One Way: Retract/Rapid Back?
                        // Usually facing one-way keeps Z down? Or lifts?
                        // Safer to lift if rapid-ing back over material? 
                        // But if facing, we just cut the top off. 
                        // If we rapid back at cut depth, we drag tool.
                        // Ideally: Lift Z (RapidZ), Rapid XY to Start, Plunge.
                        
                        // Lift
                        if (p.enableRapid) lines.push(`G1 Z${(p.safeZ).toFixed(3)} F${p.rapidZ}`); // Or SafeZ? Usually just a clearance.
                        else lines.push(`G0 Z${(p.safeZ).toFixed(3)}`);
                        
                        // Move to Next Start
                        const nextStartX = cutDir === 1 ? startX : endX;
                        lines.push(this.getRapidXY(nextStartX + t.x, nextY + t.y));
                        
                        // Plunge
                        lines.push(`G1 Z${currentZ.toFixed(3)} F${p.feedRate / 2}`);
                    }
                    
                    y = nextY;
                    
                    if (y === endY && nextY === endY) {
                         // End of loop check (similar to before)
                    }
                } else {
                    break;
                }
            }
            
            // Retract for next Z pass
            lines.push(this.getRapidZ(p.safeZ));
        }
    }

    getLeadIn(shape, startPos, offset, p) {
        if (!p.leadType || p.leadType === 'none' || !p.leadInLen) return null;
        
        const len = p.leadInLen;
        const feed = p.feedRate;
        const moves = [];
        let leadStart = { ...startPos };

        // Tangent Vector at Start (Normalized)
        // Square: Start Bottom-Left, First Move Right (1, 0)
        // Circle: Start 3 o'clock, First Move Up (0, 1)
        let tx = 0, ty = 0;
        let nx = 0, ny = 0; // Normal pointing OUT from shape

        if (shape === 'square' || shape === 'rectangle') {
            tx = 1; ty = 0;
            nx = 0; ny = -1; // Bottom edge normal is down
        } else if (shape === 'circle') {
            tx = 0; ty = 1;
            nx = 1; ny = 0; // 3 o'clock normal is right
        } else if (shape === 'sketch' && p.sketchPoints.length > 1) {
             // Vector P0 -> P1
             const p0 = p.sketchPoints[0];
             const p1 = p.sketchPoints[1];
             const dx = p1.x - p0.x;
             const dy = p1.y - p0.y;
             const mag = Math.sqrt(dx*dx + dy*dy);
             if(mag > 0) { tx = dx/mag; ty = dy/mag; }
             nx = ty; ny = -tx; // Right hand normal
        }

        if (p.leadType === 'linear') {
            // Linear Tangent: Start = Target - Tangent * Len
            leadStart.x = startPos.x - (tx * len);
            leadStart.y = startPos.y - (ty * len);
            moves.push(`G1 X${startPos.x.toFixed(3)} Y${startPos.y.toFixed(3)} F${feed}`);
        } 
        else if (p.leadType === 'radius' && shape === 'circle') {
            // Radius Lead for Circle
            // 90 deg arc
            // Tangent at End (startPos) must be (tx, ty).
            // Center of Arc must be perpendicular to tangent.
            // If Outside Cut: Center is Outward. StartPos + Normal * R.
            // If Inside Cut: Center is Inward. StartPos - Normal * R.
            
            const isInside = p.operation === 'inside';
            // If Trace (center), treat as outside for now
            
            // Vector to Center
            let cx = isInside ? -nx : nx; 
            let cy = isInside ? -ny : ny;
            
            // Center Point
            const centerX = startPos.x + (cx * len);
            const centerY = startPos.y + (cy * len);
            
            // Start Point on Arc (90 deg back)
            // Tangent at Start should be Perpendicular to (tx, ty).
            // Actually simpler: Rotate StartPos around Center by +/- 90.
            // If Outside (Center Out):
            // Arc goes Left/In to touch wall.
            // Start Point is (CenterX + ty*R, CenterY - tx*R)? 
            
            // Let's use relative I,J logic.
            // End is StartPos.
            // Center is (CenterX, CenterY).
            // I_end = CenterX - StartPos.x = cx*len
            // J_end = CenterY - StartPos.y = cy*len
            
            // Start of Arc: 
            // We want G3 (CCW) or G2 (CW)? 
            // Usually Lead In curves in same direction? 
            // Circle is CCW. Lead In usually CCW.
            
            // If CCW Arc ending at StartPos with Tangent (tx, ty).
            // Center is LEFT of Tangent.
            // Tangent is (0, 1). Left is (-1, 0).
            // So Center is at StartPos + (-1, 0)*R = StartPos - Normal*R?
            // Wait, Normal for Circle (3 oclock) is (1, 0).
            // So Center is StartPos - Normal*R = Inward?
            // Yes, if we are tracing CCW, center of curvature is Inward.
            // So a Tangent Arc must also have center Inward?
            // That would mean Lead Arc is part of the Circle? No.
            
            // We want to come from Outside.
            // So Center of Lead Arc must be Outward?
            // If Center is Outward (Right), and we move CCW.
            // 3 o'clock: Outward is Right. Center at (R+r, 0).
            // Arc from (R+r, -r) -> (R, 0).
            // Tangent at (R, 0) for that arc is (0, 1). Correct.
            // So Center is Outward.
            
            if (p.operation === 'outside' || p.operation === 'center') {
                // Center Outward
                // Start Point: (StartPos.x + nx*len + ty*len, StartPos.y + ny*len - tx*len) ?
                // Let's visualize. Center (Start.x + len, Start.y).
                // We want to end at Start. Arc is CCW.
                // Start Point must be "below".
                // (Center.x, Center.y - len).
                
                // Rotated -90 deg relative to normal?
                leadStart.x = centerX + (ny * len); 
                leadStart.y = centerY + (-nx * len); // (0, -1) relative to Center
                
                // G3 to StartPos.
                // I, J from LeadStart to Center.
                const I = centerX - leadStart.x;
                const J = centerY - leadStart.y;
                
                moves.push(`G3 X${startPos.x.toFixed(3)} Y${startPos.y.toFixed(3)} I${I.toFixed(3)} J${J.toFixed(3)} F${feed}`);
                
            } else {
                // Inside: Center Inward.
                // Center (Start.x - len, Start.y).
                // We want end at Start. Arc CCW.
                // Start Point must be "below"? No.
                // If Center is Left. Arc CCW.
                // To arrive at (R, 0) heading Up (0, 1).
                // We must come from Right of Center?
                // (Center.x + len, Center.y) = StartPos.
                // That's a full circle?
                // No.
                // LeadIn: We want to start inside the hole.
                // StartPos (R, 0). Center (R-len, 0).
                // We want to arrive at (R, 0) moving Up.
                // CCW Arc.
                // Start must be (Center.x + len, Center.y) ?? That is StartPos.
                
                // Wait. If we are Inside, we want to start *further in*.
                // And Arc *Out* to the wall.
                // So Center should be somewhat Up/Down?
                // Tangent at StartPos is Up.
                // Perpendicular is Left/Right.
                // Center must be on Left/Right line.
                // If Center is Left (Inward):
                // Arc touches StartPos at rightmost point.
                // Tangent is Up.
                // So we approach from Bottom-Right of Center?
                // Start Point: (Center.x, Center.y - len).
                // Moves to (Center.x + len, Center.y).
                // I from Start to Center: (0, len).
                // Start Point is (StartPos.x - len, StartPos.y - len).
                
                const cX = startPos.x - (nx * len);
                const cY = startPos.y - (ny * len);
                
                leadStart.x = cX + (ny * len); // +0
                leadStart.y = cY + (-nx * len); // -1 * len
                
                const I = cX - leadStart.x;
                const J = cY - leadStart.y;
                
                moves.push(`G3 X${startPos.x.toFixed(3)} Y${startPos.y.toFixed(3)} I${I.toFixed(3)} J${J.toFixed(3)} F${feed}`);
            }
        }
        else {
             // Fallback for other shapes/modes to Linear or None
             // For Square Radius lead - defaulting to Linear for safety as discussed
             if (p.leadType === 'radius') {
                 // Fallback Linear
                 leadStart.x = startPos.x - (tx * len);
                 leadStart.y = startPos.y - (ty * len);
                 moves.push(`G1 X${startPos.x.toFixed(3)} Y${startPos.y.toFixed(3)} F${feed}`);
             }
        }

        return { start: leadStart, moves: moves };
    }

    getLeadOut(shape, startPos, offset, p) {
        if (!p.leadType || p.leadType === 'none' || !p.leadOutLen) return null;
        
        const len = p.leadOutLen;
        const feed = p.feedRate;
        const moves = [];
        
        // Tangent Vector at End (Same as Start for closed loop)
        // We want to depart from StartPos.
        // For Square: End Tangent is Down (0, -1). (Left Edge closing loop)
        // For Circle: End Tangent is Up (0, 1). (Closing loop)
        
        let tx = 0, ty = 0;
        let nx = 0, ny = 0;

        if (shape === 'square' || shape === 'rectangle') {
            tx = 0; ty = -1; // Moving Down
            nx = 1; ny = 0;  // Normal Out (Right)
        } else if (shape === 'circle') {
            tx = 0; ty = 1; // Moving Up
            nx = 1; ny = 0; // Normal Out (Right)
        } else if (shape === 'sketch' && p.sketchPoints.length > 1) {
            // Vector P_last -> P0
            const p0 = p.sketchPoints[0];
            const pLast = p.sketchPoints[p.sketchPoints.length - 1];
            const dx = p0.x - pLast.x;
            const dy = p0.y - pLast.y;
            const mag = Math.sqrt(dx*dx + dy*dy);
            if(mag > 0) { tx = dx/mag; ty = dy/mag; }
             nx = ty; ny = -tx; 
        }

        if (p.leadType === 'linear') {
            // Linear Tangent: Target = StartPos + Tangent * Len
            const endX = startPos.x + (tx * len);
            const endY = startPos.y + (ty * len);
            moves.push(`G1 X${endX.toFixed(3)} Y${endY.toFixed(3)} F${feed}`);
        }
        else if (p.leadType === 'radius' && shape === 'circle') {
             const isInside = p.operation === 'inside';
             
             // Center Position
             // Outside: Outward (Start + N*len)
             // Inside: Inward (Start - N*len)
             let cx = isInside ? -nx : nx;
             let cy = isInside ? -ny : ny;
             
             const cX = startPos.x + (cx * len);
             const cY = startPos.y + (cy * len);
             const I = cX - startPos.x;
             const J = cY - startPos.y;
             
             // End Point Calculation
             let relEndX, relEndY, dir;
             
             if (!isInside) {
                 // Outside: Curve Right (Away) -> CW (G2)
                 // Start Rel: (-len, 0) (if nx=1)
                 // CW 90: (x,y) -> (y, -x)
                 // (-len, 0) -> (0, len)
                 // End Rel: (0, len) -> Up and Right.
                 // Vector Math: Rotate (-cx, -cy) CW 90.
                 // (-cx, -cy) is Vector Center->Start.
                 // CW: (-cy, cx)
                 relEndX = -cy * len;
                 relEndY = cx * len;
                 dir = 'G2';
             } else {
                 // Inside: Curve Left (Into Hole) -> CCW (G3)
                 // Start Rel: (len, 0) (if nx=1, cx=-1).
                 // Center is Left. Start is Right.
                 // Vector Center->Start is (len, 0).
                 // CCW 90: (x,y) -> (-y, x)
                 // (len, 0) -> (0, len)
                 // End Rel: (0, len) -> Up and Left.
                 // Vector Math: Rotate (-cx, -cy) CCW 90.
                 // CCW: (cy, -cx)
                 // If cx=-1, cy=0. -cx=1. -> (0, 1). Correct.
                 relEndX = cy * len;
                 relEndY = -cx * len;
                 dir = 'G3';
             }
             
             const finalX = cX + relEndX;
             const finalY = cY + relEndY;
             
             moves.push(`${dir} X${finalX.toFixed(3)} Y${finalY.toFixed(3)} I${I.toFixed(3)} J${J.toFixed(3)} F${feed}`);
        }
        else {
             // Fallback Linear
             if (p.leadType === 'radius') {
                const endX = startPos.x + (tx * len);
                const endY = startPos.y + (ty * len);
                moves.push(`G1 X${endX.toFixed(3)} Y${endY.toFixed(3)} F${feed}`);
             }
        }
        
        return { moves };
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
        else if (shape === 'sketch') {
            if (p.sketchPoints && p.sketchPoints.length > 0) {
                return { x: p.sketchPoints[0].x + t.x, y: p.sketchPoints[0].y + t.y };
            }
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

        if (shape === 'sketch') {
            if (p.sketchPoints && p.sketchPoints.length > 1) {
                // Sketch points are relative to center (0,0)
                // We are already at point 0.
                for (let i = 1; i < p.sketchPoints.length; i++) {
                    const pt = p.sketchPoints[i];
                    moves.push(`G1 X${(pt.x + t.x).toFixed(3)} Y${(pt.y + t.y).toFixed(3)} F${feedRate}`);
                }
                // Close loop (Sketcher doesn't duplicate last point)
                const start = p.sketchPoints[0];
                moves.push(`G1 X${(start.x + t.x).toFixed(3)} Y${(start.y + t.y).toFixed(3)} F${feedRate}`);
            }
            return moves;
        }

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
